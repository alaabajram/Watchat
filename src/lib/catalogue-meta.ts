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

/**
 * What kind of series it is, as viewers see it in Explore: micro drama (video episodes) or one of the four story
 * looks. One list so the filter chips, cards and banner all say the same thing.
 */
export type SeriesKind = "micro_drama" | "visual_novel" | "chat" | "motion_comic" | "photo";
export const SERIES_KINDS: { key: SeriesKind; ar: string; en: string }[] = [
  { key: "micro_drama", ar: "دراما قصيرة", en: "Micro drama" },
  { key: "visual_novel", ar: "رواية بصرية", en: "Visual novel" },
  { key: "chat", ar: "قصة محادثة", en: "Chat story" },
  { key: "motion_comic", ar: "كوميك متحرك", en: "Motion comic" },
  { key: "photo", ar: "قصة بالصور", en: "Photo story" },
];
const STORY_KINDS = new Set<SeriesKind>(["visual_novel", "chat", "motion_comic", "photo"]);

/** The kind from the series row (`format` video | story, `story_style`). Unknown story looks count as visual novels. */
export function seriesKind(format: string | null | undefined, storyStyle: string | null | undefined): SeriesKind {
  if (format !== "story") return "micro_drama";
  return STORY_KINDS.has(storyStyle as SeriesKind) ? (storyStyle as SeriesKind) : "visual_novel";
}

export const kindLabel = (k: SeriesKind, locale: "ar" | "en") => {
  const f = SERIES_KINDS.find((x) => x.key === k)!;
  return locale === "ar" ? f.ar : f.en;
};

export const isSeriesKind = (v: unknown): v is SeriesKind => SERIES_KINDS.some((k) => k.key === v);
