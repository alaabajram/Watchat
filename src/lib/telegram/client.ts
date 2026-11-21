// Telegram Bot API calls (server only). Bot messages to "tg:" addresses arrive here from sendWhatsApp, so every
// sender in the app (bot, flows, sequences, campaigns, growth, admin) reaches Telegram viewers the same way.
// There are no templates on Telegram: a template is rendered from the label's template library as a normal
// message with its link or quick-reply button (and is free to send).

import { env } from "../env";
import { siteUrl } from "../site/store";
import { currentTenantId, db } from "../supabase";
import type { SendResult } from "../whatsapp/client";
import type { OutMessage } from "../whatsapp/messages";
import { chatIdOf, fillTemplate, toTelegramCalls, webhookSecret, type TgCall } from "./telegram";

const API = "https://api.telegram.org";

export const telegramConfigured = () => Boolean(env.telegramBotToken);

type TgResponse<T> = { ok: boolean; result?: T; description?: string; error_code?: number };

export async function tgCall<T = unknown>(method: string, body: Record<string, unknown> = {}): Promise<TgResponse<T>> {
  const token = env.telegramBotToken;
  if (!token) return { ok: false, description: "TELEGRAM_BOT_TOKEN is not set" };
  try {
    const res = await fetch(`${API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }))) as TgResponse<T>;
  } catch (e) {
    return { ok: false, description: e instanceof Error ? e.message : String(e) };
  }
}

/** A template from the library, in the viewer's language, as a plain Telegram message. */
async function renderTemplate(msg: Extract<OutMessage, { kind: "template" }>, site: string): Promise<OutMessage | null> {
  const { data } = await db()
    .from("wa_templates")
    .select("body, button_text, button_type")
    .eq("tenant_id", await currentTenantId())
    .eq("name", msg.name)
    .in("lang", [msg.language, "ar"])
    .order("lang", { ascending: msg.language === "ar" }) // the viewer's language first
    .limit(2);
  const row = (data ?? [])[0] as { body: string; button_text: string | null; button_type?: string | null } | undefined;
  if (!row) return null;
  const body = fillTemplate(row.body, msg.bodyParams);
  const header = msg.headerImage ? { type: "image" as const, link: msg.headerImage } : undefined;
  if (row.button_text && row.button_type === "quick_reply" && msg.quickReplyPayload) {
    return { kind: "buttons", body, header, buttons: [{ id: msg.quickReplyPayload, title: row.button_text }] };
  }
  if (row.button_text && msg.urlButtonParam) {
    return { kind: "cta_url", body, header, buttonText: row.button_text, url: `${site}/w/${msg.urlButtonParam}` };
  }
  return header ? { kind: "image", link: header.link, caption: body } : { kind: "text", body };
}

/** Send one bot message to a Telegram chat ("tg:<id>"). Never throws. */
export async function sendTelegram(to: string, msg: OutMessage): Promise<SendResult> {
  if (!telegramConfigured()) return { ok: false, error: "Telegram is not connected" };
  const site = (await siteUrl()).replace(/\/$/, "");
  const chatId = chatIdOf(to);
  const out = msg.kind === "template" ? await renderTemplate(msg, site) : msg;
  if (!out) return { ok: false, error: `template ${msg.kind === "template" ? msg.name : ""} not in the library` };
  const calls: TgCall[] = toTelegramCalls(chatId, out, site);
  let lastId: number | undefined;
  for (const call of calls) {
    const r = await tgCall<{ message_id: number }>(call.method, call.body);
    if (!r.ok) {
      const error = `${r.error_code ?? ""} ${r.description ?? "unknown error"}`.trim();
      console.error("[telegram] send failed", { kind: out.kind, method: call.method, error });
      return { ok: false, error };
    }
    lastId = r.result?.message_id;
  }
  return { ok: true, waMessageId: `tg:${chatId}:${lastId ?? Date.now()}` };
}

// ---------------------------------------------------------------------------
// Setup (Admin → Settings → Brand & site → Telegram)
// ---------------------------------------------------------------------------

export type TelegramStatus = {
  configured: boolean;
  username: string | null;
  webhookUrl: string | null;
  webhookOk: boolean;
  pending: number;
  lastError: string | null;
  /** The webhook receives payment confirmations (connected after Stars payments were added). */
  paymentsReady: boolean;
};

export async function telegramStatus(): Promise<TelegramStatus> {
  if (!telegramConfigured()) return { configured: false, username: null, webhookUrl: null, webhookOk: false, pending: 0, lastError: null, paymentsReady: false };
  const [me, hook] = await Promise.all([
    tgCall<{ username?: string }>("getMe"),
    tgCall<{ url?: string; pending_update_count?: number; last_error_message?: string; allowed_updates?: string[] }>("getWebhookInfo"),
  ]);
  const site = (await siteUrl()).replace(/\/$/, "");
  const url = hook.result?.url || null;
  return {
    configured: true,
    username: me.result?.username ?? null,
    webhookUrl: url,
    webhookOk: url === `${site}/api/telegram/webhook`,
    pending: hook.result?.pending_update_count ?? 0,
    lastError: hook.result?.last_error_message ?? (me.ok ? null : (me.description ?? null)),
    paymentsReady: Boolean(hook.result?.allowed_updates?.includes("pre_checkout_query")),
  };
}

const COMMANDS = {
  ar: [
    { command: "start", description: "ابدأ" },
    { command: "menu", description: "المسلسلات" },
    { command: "continue", description: "كمّل المشاهدة" },
    { command: "store", description: "المتجر" },
    { command: "rewards", description: "بينج مجاني" },
    { command: "account", description: "حسابي" },
    { command: "help", description: "مساعدة" },
  ],
  en: [
    { command: "start", description: "Start" },
    { command: "menu", description: "Series" },
    { command: "continue", description: "Continue watching" },
    { command: "store", description: "Store" },
    { command: "rewards", description: "Free Ping" },
    { command: "account", description: "My account" },
    { command: "help", description: "Help" },
  ],
};

/** Point the bot at this site: webhook (with its secret), the menu button that opens the Mini App, and commands. */
export async function connectTelegram(): Promise<{ ok: boolean; errors: string[] }> {
  const site = (await siteUrl()).replace(/\/$/, "");
  const errors: string[] = [];
  if (!site.startsWith("https://")) return { ok: false, errors: ["The site address must be https (Brand & site → Site address)."] };
  const steps: [string, Record<string, unknown>][] = [
    [
      "setWebhook",
      {
        url: `${site}/api/telegram/webhook`,
        secret_token: webhookSecret(env.telegramBotToken),
        allowed_updates: ["message", "callback_query", "pre_checkout_query"],
        drop_pending_updates: false,
      },
    ],
    ["setChatMenuButton", { menu_button: { type: "web_app", text: "شاهد", web_app: { url: `${site}/tg` } } }],
    ["setMyCommands", { commands: COMMANDS.ar }],
    ["setMyCommands", { commands: COMMANDS.en, language_code: "en" }],
  ];
  for (const [method, body] of steps) {
    const r = await tgCall(method, body);
    if (!r.ok) errors.push(`${method}: ${r.description ?? "failed"}`);
  }
  return { ok: errors.length === 0, errors };
}
