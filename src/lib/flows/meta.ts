// Series details and artwork from the CMS, as flows use them. Pure: shared by the bot and the preview.

import { GENRE_LABELS, type CastMember } from "../content-meta";
import type { ArtSlot, Lang } from "./types";

export type SeriesArt = { poster: string | null; bannerWa: string | null; bannerWide: string | null; square: string | null };
export type SeriesMeta = { taglineAr: string | null; taglineEn: string | null; genres: string[]; cast: CastMember[] };

/** The WhatsApp banner and other sizes fall back to the poster when not uploaded yet. */
export function artUrl(art: SeriesArt, slot: ArtSlot): string | null {
  const pick = { poster: art.poster, banner_wa: art.bannerWa, banner_wide: art.bannerWide, square: art.square }[slot];
  return pick ?? art.poster;
}

export function metaVars(meta: SeriesMeta | undefined, lang: Lang): { tagline: string; genre: string; cast: string } {
  if (!meta) return { tagline: "", genre: "", cast: "" };
  const genre = meta.genres
    .map((g) => GENRE_LABELS[g as keyof typeof GENRE_LABELS]?.[lang])
    .filter(Boolean)
    .slice(0, 2)
    .join(lang === "ar" ? " و" : " & ");
  const names = meta.cast
    .map((c) => (lang === "en" ? c.name_en || c.name_ar : c.name_ar || c.name_en))
    .filter(Boolean)
    .slice(0, 3);
  return {
    tagline: (lang === "en" ? meta.taglineEn || meta.taglineAr : meta.taglineAr || meta.taglineEn) ?? "",
    genre,
    cast: names.join(lang === "ar" ? "، " : ", "),
  };
}
