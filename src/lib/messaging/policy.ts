// Rules every business-started WhatsApp message must pass, plus cost estimates.

/** No marketing messages between 22:00 and 09:00 Gulf time. */
export const QUIET_START_HOUR = 22;
export const QUIET_END_HOUR = 9;

/** At most one marketing message per viewer in this many hours (across sequences and campaigns). */
export const MARKETING_GAP_HOURS = 20;

export function gulfHour(now = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Dubai" }).format(now)) % 24;
}

export function isQuietHours(now = new Date()): boolean {
  const h = gulfHour(now);
  return h >= QUIET_START_HOUR || h < QUIET_END_HOUR;
}

/**
 * Estimated Meta fee per delivered template message, USD. Approximate rates (Oct 2026 rate card):
 * check Meta's current pricing page and update these numbers when it changes.
 */
export const RATE_USD: Record<"marketing" | "utility", Record<string, number>> = {
  marketing: { AE: 0.066, SA: 0.066, KW: 0.066, QA: 0.066, BH: 0.066, OM: 0.066, default: 0.07 },
  utility: { AE: 0.0157, SA: 0.0107, default: 0.016 },
};

export function estimateCost(category: "marketing" | "utility", countries: (string | null)[]): number {
  const rates = RATE_USD[category];
  const total = countries.reduce((sum, c) => sum + (rates[c ?? "default"] ?? rates.default), 0);
  return Math.round(total * 100) / 100;
}

/** Template language for a viewer: Arabic, or English for viewers who chose English subtitles. */
export function templateLangFor(viewerLanguage: string | null): "ar" | "en" {
  return viewerLanguage === "ar_en_subs" ? "en" : "ar";
}
