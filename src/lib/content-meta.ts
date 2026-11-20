// Options for series details in the CMS (shared by the editor and the save action).

export const GENRES = ["drama", "romance", "family", "thriller", "mystery", "comedy", "revenge", "crime", "historical", "youth"] as const;
export const GENRE_LABELS: Record<(typeof GENRES)[number], { ar: string; en: string }> = {
  drama: { ar: "دراما", en: "Drama" },
  romance: { ar: "رومانسي", en: "Romance" },
  family: { ar: "عائلي", en: "Family" },
  thriller: { ar: "إثارة", en: "Thriller" },
  mystery: { ar: "غموض", en: "Mystery" },
  comedy: { ar: "كوميدي", en: "Comedy" },
  revenge: { ar: "انتقام", en: "Revenge" },
  crime: { ar: "جريمة", en: "Crime" },
  historical: { ar: "تاريخي", en: "Historical" },
  youth: { ar: "شبابي", en: "Youth" },
};
export const AGE_RATINGS = ["G", "PG", "PG-13", "15+", "18+"] as const;

export type CastMember = { name_ar: string; name_en: string; role: string };

/** Artwork the system uses, with the size each slot is cropped to. */
export const ARTWORK_SLOTS = [
  { field: "poster_url", label: "Poster", use: "Web cards and lists", w: 1000, h: 1500 },
  { field: "banner_wide_url", label: "Wide banner", use: "Web series page header", w: 1920, h: 1080 },
  { field: "banner_wa_url", label: "WhatsApp banner", use: "Chat cards and templates", w: 1200, h: 628 },
  { field: "square_url", label: "Square", use: "Thumbnails and social", w: 1080, h: 1080 },
] as const;
export type ArtworkField = (typeof ARTWORK_SLOTS)[number]["field"];

/** Episode number from a file name: "SECRETS01_ep07.mp4", "E12 final.mov", "حلقة 3.mp4", "05.mp4". */
export function episodeNumberFromName(name: string): number | null {
  const base = name.replace(/\.[^.]+$/, "");
  const tagged = base.match(/(?:ep(?:isode)?|(?<![a-z])e|حلقة|الحلقة)[\s._-]*0*(\d{1,3})(?!\d)/i);
  if (tagged) return Number(tagged[1]);
  const all = [...base.matchAll(/(?<![a-z\d])0*(\d{1,3})(?!\d)/gi)].map((m) => Number(m[1])).filter((n) => n > 0);
  return all.length ? all[all.length - 1] : null;
}
