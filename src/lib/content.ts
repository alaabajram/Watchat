// Read-side helpers for the web player.

import { currentTenantId, db } from "./supabase";

export type WebSeries = {
  id: string;
  code: string;
  titleAr: string;
  titleEn: string;
  synopsisAr: string | null;
  synopsisEn: string | null;
  posterUrl: string | null;
  freeWebUntilEp: number;
  paywallEp: number;
  coinsPerEpisode: number;
  seasonPassPriceAed: number | null;
};

export type WebEpisode = {
  id: string;
  number: number;
  titleAr: string | null;
  titleEn: string | null;
  streamUid: string | null;
  coinPrice: number | null;
};

export async function getSeriesByCode(code: string): Promise<WebSeries | null> {
  const tenantId = await currentTenantId();
  const { data } = await db()
    .from("series")
    .select(
      "id, code, title_ar, title_en, synopsis_ar, synopsis_en, poster_url, free_web_until_ep, paywall_ep, coins_per_episode, season_pass_price_aed",
    )
    .eq("tenant_id", tenantId)
    .eq("code", code.toUpperCase())
    .eq("status", "live")
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    code: data.code,
    titleAr: data.title_ar,
    titleEn: data.title_en,
    synopsisAr: data.synopsis_ar,
    synopsisEn: data.synopsis_en,
    posterUrl: data.poster_url,
    freeWebUntilEp: data.free_web_until_ep,
    paywallEp: data.paywall_ep,
    coinsPerEpisode: data.coins_per_episode,
    seasonPassPriceAed: data.season_pass_price_aed,
  };
}

export async function getEpisodes(seriesId: string): Promise<WebEpisode[]> {
  const { data } = await db()
    .from("episodes")
    .select("id, number, title_ar, title_en, stream_uid, coin_price_override")
    .eq("series_id", seriesId)
    .eq("status", "live")
    .order("number");
  return (data ?? []).map((e) => ({
    id: e.id,
    number: e.number,
    titleAr: e.title_ar,
    titleEn: e.title_en,
    streamUid: e.stream_uid,
    coinPrice: e.coin_price_override,
  }));
}

/** Episode numbers this viewer has unlocked (null in the set = whole series via season pass). */
export async function getUnlocked(viewerId: string, seriesId: string): Promise<{ all: boolean; episodes: Set<number> }> {
  const { data } = await db()
    .from("entitlements")
    .select("episode_number")
    .eq("viewer_id", viewerId)
    .eq("series_id", seriesId);
  const rows = data ?? [];
  return {
    all: rows.some((r) => r.episode_number === null),
    episodes: new Set(rows.filter((r) => r.episode_number !== null).map((r) => r.episode_number as number)),
  };
}

export function canWatch(series: WebSeries, episodeNumber: number, unlocked: { all: boolean; episodes: Set<number> }) {
  return episodeNumber <= series.freeWebUntilEp || unlocked.all || unlocked.episodes.has(episodeNumber);
}
