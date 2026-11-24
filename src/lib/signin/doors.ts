// The ways into Watchat on one page (pure, no server code): WhatsApp, Telegram, phone number (code by SMS
// through Prelude) and email (a one-time link). Which ones show, in which order, and the small checks behind
// them (phone and email clean-up, "is WhatsApp actually sending?").

export type Door = "whatsapp" | "telegram" | "phone" | "email";

/** Email-only viewers live at "+em:<id>" (like Telegram's "+tg:<id>"); they have no chat. */
export const EMAIL_PREFIX = "em:";
export const isEmailAddress = (to: string | null | undefined) => Boolean(to && to.replace(/^\+/, "").startsWith(EMAIL_PREFIX));
export const emailAddressFor = (emailHmac: string) => `${EMAIL_PREFIX}${emailHmac.slice(0, 24)}`;

/** A clean, lower-case email, or null. */
export function normalizeEmail(input: unknown): string | null {
  const e = typeof input === "string" ? input.trim().toLowerCase() : "";
  return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(e) ? e : null;
}

/**
 * A phone number in E.164 ("+971501234567"), or null. Accepts "+971 50…", "00971…", and local numbers with the
 * visitor's country code (`cc`, digits): "050 123 4567" → +971501234567.
 */
export function normalizePhone(input: unknown, cc = "971"): string | null {
  let s = typeof input === "string" ? input.trim() : "";
  // Arabic-Indic and Persian digits → 0-9.
  s = s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  if (!s) return null;
  let digits: string;
  if (s.startsWith("+")) digits = s.slice(1).replace(/\D/g, "");
  else {
    const raw = s.replace(/\D/g, "");
    if (raw.startsWith("00")) digits = raw.slice(2);
    else if (raw.startsWith("0")) digits = cc + raw.slice(1);
    else if (raw.startsWith(cc)) digits = raw;
    else digits = cc + raw;
  }
  return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
}

/** "+971 50 ••• 4567" for showing which number a code went to. */
export const maskPhone = (e164: string) => `${e164.slice(0, 6)} ••• ${e164.slice(-4)}`;

/**
 * Is WhatsApp sending? `recent` = the latest outgoing WhatsApp messages (newest first, chat viewers only).
 * Unknown (nothing sent lately) counts as working; two or more in a row refused with an account-level error
 * ("locked", "access denied", "restricted", "disabled") means it isn't.
 */
export function whatsappWorking(recent: { status: string | null; error: string | null }[]): boolean {
  const latest = recent.slice(0, 5);
  let refusedInRow = 0;
  for (const m of latest) {
    if (m.status === "failed" && /lock|access denied|restrict|disabled|131005|131031|368/i.test(m.error ?? "")) refusedInRow++;
    else if (m.status && m.status !== "failed") break;
    else break;
  }
  return refusedInRow < 2;
}

/** The doors to show, in order: the visitor's own chat app first, then the other one, then phone, then email. */
export function doorsFor(o: { whatsapp: boolean; telegram: boolean; phone: boolean; email: boolean; prefer: "telegram" | "whatsapp" | null }): Door[] {
  const chats: Door[] = o.prefer === "telegram" ? ["telegram", "whatsapp"] : ["whatsapp", "telegram"];
  return [...chats, "phone", "email"].filter((d) => o[d as Door]) as Door[];
}

/** Calling code for the visitor's country (from their IP), for local numbers typed without one. Default UAE. */
const CALLING: Record<string, string> = { AE: "971", SA: "966", KW: "965", QA: "974", BH: "973", OM: "968", EG: "20", JO: "962", LB: "961", IQ: "964", SY: "963", PS: "970", MA: "212", DZ: "213", TN: "216", GB: "44", US: "1", CA: "1", IN: "91", PK: "92", TR: "90", FR: "33", DE: "49" };
export const callingCode = (country: string | null | undefined) => CALLING[(country ?? "").toUpperCase()] ?? "971";
