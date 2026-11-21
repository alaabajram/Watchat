// Small pure helpers for the catalogue (ranking and counts), shared by the home, explore and series pages.

/** 1, 2, 3 … by most viewers (ties keep the same order); series nobody watched get no rank. */
export function rankByViews(views: Map<string, number>): Map<string, number> {
  const sorted = [...views.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  return new Map(sorted.map(([id], i) => [id, i + 1]));
}

/** "1.2K", "890" — compact view counts for cards. */
export function compactCount(n: number, locale: "ar" | "en" = "en"): string {
  return new Intl.NumberFormat(locale === "ar" ? "ar-AE" : "en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}
