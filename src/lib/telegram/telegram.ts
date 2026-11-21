// Telegram, pure parts: a Telegram viewer is an ordinary viewer whose address is "tg:<chat id>" (stored like a
// WhatsApp number, e.g. phone_e164 "+tg:123"), so every sender, flow and shared reply works unchanged — the one
// WhatsApp send function routes "tg:" addresses here. This file turns Bot API updates into the bot's
// InboundMessage, the bot's OutMessage into Bot API calls, and checks Mini App sign-in data.
// No database or network.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { InboundMessage } from "../whatsapp/inbound";
import type { OutMessage } from "../whatsapp/messages";

export const TG_PREFIX = "tg:";
export const isTelegram = (to: string | null | undefined): boolean => Boolean(to && to.replace(/^\+/, "").startsWith(TG_PREFIX));
export const chatIdOf = (to: string) => to.replace(/^\+/, "").slice(TG_PREFIX.length);
export const tgAddress = (userId: number | string) => `${TG_PREFIX}${userId}`;

/** Telegram's limits (Bot API). */
export const TG_LIMITS = { text: 4096, caption: 1024, callbackData: 64, buttonText: 64 } as const;

const clipTo = (s: string, max: number) => (Array.from(s).length <= max ? s : Array.from(s).slice(0, max - 1).join("") + "…");

/** The webhook's shared secret, derived from the bot token (so there's nothing else to configure). */
export function webhookSecret(botToken: string): string {
  return createHash("sha256").update(`watchat-telegram-webhook:${botToken}`).digest("hex").slice(0, 48);
}

// ---------------------------------------------------------------------------
// Inbound: Bot API update → the bot's InboundMessage
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const num = (v: unknown) => (typeof v === "number" ? v : undefined);

/** Menu commands the bot answers itself (they open a page of the site inside Telegram). */
export type PageCommand = "store" | "rewards";

export type ParsedUpdate = {
  updateId: number;
  msg: InboundMessage | null;
  /** A tapped inline button: answer it so the spinner stops. */
  callbackQueryId?: string;
  /** /store or /rewards: open that page. */
  page?: PageCommand;
  /** Telegram asks to confirm a Stars payment before charging. */
  preCheckout?: { id: string; currency: string; total_amount: number; invoice_payload: string };
  /** A Stars payment went through (or a monthly renewal). */
  payment?: { chatId: number; data: Record<string, unknown> };
};

/**
 * Commands become the words the bot already understands: /start → START (menu), /start CODE → CODE (a series,
 * an invite INV-… or a partner P-… code), /menu → MENU, /continue → LINK, /account → ACCOUNT, /help → HELP.
 */
export function commandText(text: string): { text: string; page?: PageCommand } {
  const m = /^\/([a-z_]+)(?:@\w+)?(?:\s+(.+))?$/i.exec(text.trim());
  if (!m) return { text };
  const [, cmd, arg] = m;
  switch (cmd.toLowerCase()) {
    case "start":
      return { text: arg ? arg.trim().replace(/_/g, " ") : "START" };
    case "menu":
      return { text: "MENU" };
    case "continue":
      return { text: "LINK" };
    case "account":
      return { text: "ACCOUNT" };
    case "help":
      return { text: "HELP" };
    case "stop":
      return { text: "STOP" };
    case "store":
      return { text: "", page: "store" };
    case "rewards":
      return { text: "", page: "rewards" };
    default:
      return { text: "HELP" };
  }
}

export function parseUpdate(update: unknown): ParsedUpdate | null {
  const u = obj(update);
  const updateId = num(u.update_id);
  if (updateId === undefined) return null;

  const pcq = obj(u.pre_checkout_query);
  if (Object.keys(pcq).length) {
    return {
      updateId,
      msg: null,
      preCheckout: { id: str(pcq.id) ?? "", currency: str(pcq.currency) ?? "", total_amount: num(pcq.total_amount) ?? 0, invoice_payload: str(pcq.invoice_payload) ?? "" },
    };
  }

  const cb = obj(u.callback_query);
  if (Object.keys(cb).length) {
    const from = obj(cb.from);
    const chat = obj(obj(cb.message).chat);
    const chatId = num(chat.id) ?? num(from.id);
    if (chatId === undefined || (chat.type !== undefined && chat.type !== "private")) return { updateId, msg: null, callbackQueryId: str(cb.id) };
    return {
      updateId,
      callbackQueryId: str(cb.id),
      msg: {
        id: `tg:${updateId}`,
        from: tgAddress(chatId),
        timestamp: Math.floor(Date.now() / 1000),
        profileName: str(from.first_name),
        kind: "reply",
        replyId: str(cb.data),
      },
    };
  }

  const m = obj(u.message);
  const chat = obj(m.chat);
  const chatId = num(chat.id);
  // Private chats only: groups and channels never reach the bot's logic.
  if (chatId === undefined || chat.type !== "private") return { updateId, msg: null };
  const from = obj(m.from);
  const paid = obj(m.successful_payment);
  if (Object.keys(paid).length) return { updateId, msg: null, payment: { chatId, data: paid } };
  const raw = str(m.text);
  const base = { id: `tg:${updateId}`, from: tgAddress(chatId), timestamp: num(m.date) ?? 0, profileName: str(from.first_name) };
  if (raw === undefined) return { updateId, msg: { ...base, kind: "other" } };
  const { text, page } = commandText(raw);
  if (page) return { updateId, msg: null, page };
  return { updateId, msg: { ...base, kind: "text", text } };
}

// ---------------------------------------------------------------------------
// Outbound: the bot's OutMessage → Bot API calls
// ---------------------------------------------------------------------------

export type TgCall = { method: string; body: Json };
type Button = { text: string; callback_data?: string; url?: string; web_app?: { url: string } };

const fitsCallback = (id: string) => Buffer.byteLength(id, "utf8") <= TG_LIMITS.callbackData;

/** Links to the site open inside Telegram as the Mini App; anything else opens as a normal link. */
function linkButton(text: string, url: string, site: string): Button {
  const t = clipTo(text, TG_LIMITS.buttonText);
  return site && url.startsWith(site) && url.startsWith("https://") ? { text: t, web_app: { url } } : { text: t, url };
}

const keyboard = (rows: Button[][]) => ({ reply_markup: { inline_keyboard: rows.filter((r) => r.length) } });

function withMedia(chatId: string, media: { type: "video" | "image"; link: string } | undefined, text: string, markup: Json): TgCall[] {
  if (media && Array.from(text).length <= TG_LIMITS.caption) {
    return [
      media.type === "video"
        ? { method: "sendVideo", body: { chat_id: chatId, video: media.link, caption: text, supports_streaming: true, ...markup } }
        : { method: "sendPhoto", body: { chat_id: chatId, photo: media.link, caption: text, ...markup } },
    ];
  }
  // Too long for a caption: the media first, then the text with its buttons.
  const pre: TgCall[] = media
    ? [media.type === "video" ? { method: "sendVideo", body: { chat_id: chatId, video: media.link, supports_streaming: true } } : { method: "sendPhoto", body: { chat_id: chatId, photo: media.link } }]
    : [];
  return [...pre, { method: "sendMessage", body: { chat_id: chatId, text: clipTo(text, TG_LIMITS.text), link_preview_options: { is_disabled: true }, ...markup } }];
}

/**
 * Turn one bot message into Bot API calls. Buttons and list rows become inline buttons (one per row) whose
 * callback data is the same reply id WhatsApp would return; link buttons to the site open the Mini App.
 * Templates are rendered beforehand (telegram/client.ts) — there are no templates on Telegram.
 */
export function toTelegramCalls(chatId: string, msg: OutMessage, site: string): TgCall[] {
  const join = (body: string, footer?: string) => (footer ? `${body}\n\n${footer}` : body);
  switch (msg.kind) {
    case "text":
      return [{ method: "sendMessage", body: { chat_id: chatId, text: clipTo(msg.body, TG_LIMITS.text), link_preview_options: { is_disabled: true } } }];
    case "video":
      return [{ method: "sendVideo", body: { chat_id: chatId, video: msg.link, supports_streaming: true, ...(msg.caption ? { caption: clipTo(msg.caption, TG_LIMITS.caption) } : {}) } }];
    case "image":
      return [{ method: "sendPhoto", body: { chat_id: chatId, photo: msg.link, ...(msg.caption ? { caption: clipTo(msg.caption, TG_LIMITS.caption) } : {}) } }];
    case "buttons": {
      const rows = msg.buttons.filter((b) => fitsCallback(b.id)).map((b) => [{ text: clipTo(b.title, TG_LIMITS.buttonText), callback_data: b.id }]);
      return withMedia(chatId, msg.header, join(msg.body, msg.footer), keyboard(rows));
    }
    case "cta_url":
      return withMedia(chatId, msg.header, join(msg.body, msg.footer), keyboard([[linkButton(msg.buttonText, msg.url, site)]]));
    case "list": {
      const rows = msg.sections.flatMap((s) => s.rows).filter((r) => fitsCallback(r.id)).map((r) => [{ text: clipTo(r.title, TG_LIMITS.buttonText), callback_data: r.id }]);
      return [{ method: "sendMessage", body: { chat_id: chatId, text: clipTo(msg.body, TG_LIMITS.text), ...keyboard(rows) } }];
    }
    case "template":
      return []; // rendered from the template library before this point
  }
}

/** Fill a template body's {{1}}, {{2}}… with its parameters. */
export function fillTemplate(body: string, params: string[] = []): string {
  return body.replace(/\{\{(\d+)\}\}/g, (all, n) => params[Number(n) - 1] ?? all);
}

// ---------------------------------------------------------------------------
// Mini App sign-in: verify the init data Telegram signs for the bot
// ---------------------------------------------------------------------------

export type MiniAppUser = { id: number; firstName: string | null; language: string | null; startParam: string | null };

/**
 * Telegram signs the Mini App's init data with the bot token (HMAC-SHA256, key = HMAC("WebAppData", token)).
 * Valid for a day; anything else is rejected.
 */
export function verifyInitData(initData: string, botToken: string, nowSec: number, maxAgeSec = 86400): MiniAppUser | null {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null;
  params.delete("hash");
  const check = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(check).digest();
  const given = Buffer.from(hash, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || nowSec - authDate > maxAgeSec || authDate - nowSec > 300) return null;
  let user: Json;
  try {
    user = obj(JSON.parse(params.get("user") ?? "{}"));
  } catch {
    return null;
  }
  const id = num(user.id);
  if (!id) return null;
  return { id, firstName: str(user.first_name) ?? null, language: str(user.language_code) ?? null, startParam: params.get("start_param") };
}

/** Where a Mini App start parameter leads: a series code opens the series, anything else the home page. */
export function startTarget(startParam: string | null): string {
  if (startParam && /^[A-Z0-9]{3,20}$/i.test(startParam)) return `/series/${startParam.toUpperCase()}`;
  return "/";
}
