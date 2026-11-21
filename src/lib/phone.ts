// Country from a WhatsApp number (wa_id: digits with country code). Used for currency (AED / SAR)
// and segments. Only the markets we sell in are mapped; others return null.

const PREFIXES: [string, string][] = [
  ["971", "AE"],
  ["966", "SA"],
  ["965", "KW"],
  ["974", "QA"],
  ["973", "BH"],
  ["968", "OM"],
];

export function countryFromPhone(waId: string): string | null {
  if (waId.replace(/^\+/, "").startsWith("tg:")) return null; // Telegram viewers have no number
  const digits = waId.replace(/\D/g, "");
  return PREFIXES.find(([prefix]) => digits.startsWith(prefix))?.[1] ?? null;
}

/** Checkout currency: SAR for Saudi numbers, AED for everyone else. */
export function currencyFor(country: string | null): "AED" | "SAR" {
  return country === "SA" ? "SAR" : "AED";
}
