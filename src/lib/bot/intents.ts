import { parseButtonReplyId, parseSharedReplyId } from "../flows/types";
import type { InboundMessage } from "../whatsapp/inbound";

// Button / list-row ids the bot sends. Keep them short and stable: viewers may tap old messages.
export const IDS = {
  langAr: "lang:ar",
  langEn: "lang:en",
  start: "ep:start",
  next: "ep:next",
  notForMe: "ep:nfm",
  optInYes: "optin:yes",
  optInNo: "optin:no",
  seriesPrefix: "series:",
  menuLink: "menu:link",
  menuLang: "menu:lang",
  menuAlerts: "menu:alerts",
  menuSupport: "menu:support",
} as const;

export type Intent =
  | { type: "series_code"; code: string }
  | { type: "language"; lang: "ar" | "ar_en_subs" }
  | { type: "next_episode" }
  | { type: "not_for_me" }
  | { type: "opt_in"; yes: boolean }
  | { type: "stop" }
  | { type: "menu" }
  | { type: "link" }
  | { type: "account" }
  | { type: "change_language" }
  | { type: "toggle_alerts" }
  | { type: "support" }
  | { type: "delete_data" }
  | { type: "confirm_code"; code: string }
  | { type: "watch"; code: string; episode: number | null }
  | { type: "flow_reply"; nodeId: string; port: string }
  | { type: "shared_reply"; nodeId: string; port: string }
  | { type: "growth_picks"; suggestionId: string }
  | { type: "unknown"; text?: string };

const STOP_WORDS = ["STOP", "UNSUBSCRIBE", "إيقاف", "ايقاف", "توقف", "الغاء", "إلغاء"];
// "ابدأ" / "START" is pre-filled by the watchat.pro splash button, so a new visitor lands on the menu.
const MENU_WORDS = ["MENU", "HELP", "START", "القائمة", "قائمة", "مساعدة", "ابدأ", "ابدا"];
const LINK_WORDS = ["LINK", "رابط", "الرابط", "رابطي"];
// "My account" — sent from watchat.pro/me when the browser isn't signed in.
const ACCOUNT_WORDS = ["ACCOUNT", "MYACCOUNT", "LOGIN", "SIGNIN", "حسابي", "الحساب", "حساب", "دخول", "تسجيلدخول", "تسجيلالدخول"];
const DELETE_WORDS = ["DELETEMYDATA", "DELETEDATA", "احذفبياناتي", "حذفبياناتي"];

// Series codes look like SECRETS01: 3+ Latin letters followed by 1–3 digits.
const SERIES_CODE = /\b([A-Z]{3,}\d{1,3})\b/;

/** Western digits for Arabic-Indic numerals, so "SECRETS٠١" still matches. */
function normaliseDigits(text: string): string {
  return text.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

export function parseIntent(msg: InboundMessage): Intent {
  if (msg.kind === "reply" && msg.replyId) return intentFromReplyId(msg.replyId);

  if (msg.kind === "text" && msg.text) {
    const text = normaliseDigits(msg.text.trim());
    const upper = text.toUpperCase();
    const word = upper.replace(/[^\p{L}\p{N}]/gu, "");

    if (DELETE_WORDS.includes(word)) return { type: "delete_data" };
    // "CONFIRM 123456" / "تأكيد 123456": proves the viewer owns this number before spending on a new device.
    // "WATCH SECRETS01 4" — sent from the "continue in WhatsApp" page: a personal link for THIS number.
    const watch = upper.match(/^(?:WATCH|شاهد|مشاهدة)\s+([A-Z]{3,}\d{1,3})(?:\s+(\d{1,3}))?$/u);
    if (watch) return { type: "watch", code: watch[1], episode: watch[2] ? Number(watch[2]) : null };
    const confirm = upper.match(/^(?:CONFIRM|تأكيد|تاكيد)\s*([0-9]{6})$/u);
    if (confirm) return { type: "confirm_code", code: confirm[1] };
    if (STOP_WORDS.includes(word) || STOP_WORDS.includes(text)) return { type: "stop" };
    if (MENU_WORDS.includes(word) || MENU_WORDS.includes(text)) return { type: "menu" };
    if (LINK_WORDS.includes(word) || LINK_WORDS.includes(text)) return { type: "link" };
    if (ACCOUNT_WORDS.includes(word)) return { type: "account" };

    const code = upper.match(SERIES_CODE);
    if (code) return { type: "series_code", code: code[1] };

    return { type: "unknown", text };
  }
  return { type: "unknown" };
}

export function intentFromReplyId(id: string): Intent {
  switch (id) {
    case IDS.langAr:
      return { type: "language", lang: "ar" };
    case IDS.langEn:
      return { type: "language", lang: "ar_en_subs" };
    case IDS.start:
    case IDS.next:
      return { type: "next_episode" };
    case IDS.notForMe:
      return { type: "not_for_me" };
    case IDS.optInYes:
      return { type: "opt_in", yes: true };
    case IDS.optInNo:
      return { type: "opt_in", yes: false };
    case IDS.menuLink:
      return { type: "link" };
    case IDS.menuLang:
      return { type: "change_language" };
    case IDS.menuAlerts:
      return { type: "toggle_alerts" };
    case IDS.menuSupport:
      return { type: "support" };
  }
  const picks = id.match(/^growth:([0-9a-f-]{36})$/);
  if (picks) return { type: "growth_picks", suggestionId: picks[1] };
  const shared = parseSharedReplyId(id);
  if (shared) return { type: "shared_reply", ...shared };
  const flow = parseButtonReplyId(id);
  if (flow) return { type: "flow_reply", ...flow };
  if (id.startsWith(IDS.seriesPrefix)) return { type: "series_code", code: id.slice(IDS.seriesPrefix.length) };
  return { type: "unknown" };
}
