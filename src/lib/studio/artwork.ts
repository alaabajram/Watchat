// Series artwork from the Studio (poster, banners, square) — pure. Claude reserves credits against the
// per-series artwork cap, then attaches the picture to a slot. It goes straight onto the series while the
// series is not live or the slot is empty; on a live series it replaces nothing until the team says "Use it"
// (kept as a proposal in `series.studio_artwork`).

import { ARTWORK_SLOTS, type ArtworkField } from "@/lib/content-meta";

export const ARTWORK_CAP_DEFAULT = 400;

export type StudioArtSlot = "poster" | "banner_wide" | "banner_wa" | "square";

export const STUDIO_ART: Record<StudioArtSlot, { field: ArtworkField; ratio: string; w: number; h: number; use: string }> = Object.fromEntries(
  ARTWORK_SLOTS.map((s) => {
    const key = s.field.replace(/_url$/, "") as StudioArtSlot;
    const g = gcd(s.w, s.h);
    return [key, { field: s.field, ratio: `${s.w / g}:${s.h / g}`, w: s.w, h: s.h, use: `${s.label}: ${s.use}` }];
  }),
) as Record<StudioArtSlot, { field: ArtworkField; ratio: string; w: number; h: number; use: string }>;

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

export const STUDIO_ART_SLOTS = Object.keys(STUDIO_ART) as StudioArtSlot[];

/** "Poster" / "banner-wide" / "poster_url" → a slot, or null. */
export function artSlot(name: unknown): StudioArtSlot | null {
  if (typeof name !== "string") return null;
  const k = name.trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/_url$/, "");
  return (STUDIO_ART_SLOTS as string[]).includes(k) ? (k as StudioArtSlot) : null;
}

/** Where a new picture for a slot goes: onto the series, or waiting for the team (live series with art there). */
export function artworkPlacement(seriesStatus: string, current: string | null | undefined): "set" | "proposal" {
  return seriesStatus === "live" && Boolean(current) ? "proposal" : "set";
}

export type ArtProposal = { url: string; path: string; at: string; note: string };

/** Pending proposals kept on the series (one per slot, the latest wins). */
export function sanitizeProposals(v: unknown): Partial<Record<StudioArtSlot, ArtProposal>> {
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const out: Partial<Record<StudioArtSlot, ArtProposal>> = {};
  for (const slot of STUDIO_ART_SLOTS) {
    const p = o[slot] as Record<string, unknown> | undefined;
    if (!p || typeof p.url !== "string" || !/^https:\/\//.test(p.url)) continue;
    out[slot] = {
      url: p.url.slice(0, 500),
      path: typeof p.path === "string" ? p.path.slice(0, 300) : "",
      at: typeof p.at === "string" ? p.at : "",
      note: typeof p.note === "string" ? p.note.slice(0, 200) : "",
    };
  }
  return out;
}
