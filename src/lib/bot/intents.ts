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
  | { type: "change_language" }
  | { type: "toggle_alerts" }
  | { type: "support" }
  | { type: "unknown"; text?: string };

const STOP_WORDS = ["STOP", "UNSUBSCRIBE", "إيقاف", "ايقاف", "توقف", "الغاء", "إلغاء"];
const MENU_WORDS = ["MENU", "HELP", "القائمة", "قائمة", "مساعدة"];
const LINK_WORDS = ["LINK", "رابط", "الرابط", "رابطي"];

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

    if (STOP_WORDS.includes(word) || STOP_WORDS.includes(text)) return { type: "stop" };
    if (MENU_WORDS.includes(word) || MENU_WORDS.includes(text)) return { type: "menu" };
    if (LINK_WORDS.includes(word) || LINK_WORDS.includes(text)) return { type: "link" };

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
  if (id.startsWith(IDS.seriesPrefix)) return { type: "series_code", code: id.slice(IDS.seriesPrefix.length) };
  return { type: "unknown" };
}
