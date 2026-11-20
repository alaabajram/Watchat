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
  bannerWideUrl: string | null;
  freeWebUntilEp: number;
  paywallEp: number;
  coinsPerEpisode: number;
  seasonPassPriceAed: number | null;
  seasonPassPriceSar: number | null;
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
      "id, code, title_ar, title_en, synopsis_ar, synopsis_en, poster_url, banner_wide_url, free_web_until_ep, paywall_ep, coins_per_episode, season_pass_price_aed, season_pass_price_sar",
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
    bannerWideUrl: data.banner_wide_url,
    freeWebUntilEp: data.free_web_until_ep,
    paywallEp: data.paywall_ep,
    coinsPerEpisode: data.coins_per_episode,
    seasonPassPriceAed: data.season_pass_price_aed === null ? null : Number(data.season_pass_price_aed),
    seasonPassPriceSar: data.season_pass_price_sar === null ? null : Number(data.season_pass_price_sar),
  };
}

export async function getEpisodes(seriesId: string): Promise<WebEpisode[]> {
  const { data } = await db()
    .from("episodes")
    .select("id, number, title_ar, title_en, stream_uid, coin_price_override")
    .eq("series_id", seriesId)
    .eq("status", "live")
    .or(`release_at.is.null,release_at.lte.${new Date().toISOString()}`) // scheduled episodes appear at their release time
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
/** Next scheduled episode (for "new episode on …" on the series page). */
export async function getNextRelease(seriesId: string): Promise<{ number: number; releaseAt: string } | null> {
  const { data } = await db()
    .from("episodes")
    .select("number, release_at")
    .eq("series_id", seriesId)
    .eq("status", "live")
    .gt("release_at", new Date().toISOString())
    .order("release_at")
    .limit(1)
    .maybeSingle();
  return data ? { number: data.number, releaseAt: data.release_at } : null;
}

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

/** Cloudflare Stream HLS manifest and poster for a video id. */
export function streamUrls(streamUid: string | null, customerCode: string) {
  if (!streamUid || !customerCode) return { hls: null, poster: null };
  const base = `https://customer-${customerCode}.cloudflarestream.com/${streamUid}`;
  return { hls: `${base}/manifest/video.m3u8`, poster: `${base}/thumbnails/thumbnail.jpg?time=1s&height=960` };
}

/** Saved position (seconds) for one episode, if the viewer stopped mid-way. */
export async function getPosition(viewerId: string, episodeId: string): Promise<number> {
  const { data } = await db()
    .from("progress")
    .select("position_s, completed_at")
    .eq("viewer_id", viewerId)
    .eq("episode_id", episodeId)
    .maybeSingle();
  if (!data || data.completed_at) return 0;
  return data.position_s ?? 0;
}

/** Episode numbers watched to the end, and the last one started, for "continue watching". */
export async function getSeriesProgress(viewerId: string, seriesId: string): Promise<{ completed: Set<number>; lastStarted: number | null }> {
  const { data } = await db()
    .from("progress")
    .select("completed_at, updated_at, episodes!inner(number, series_id)")
    .eq("viewer_id", viewerId)
    .eq("episodes.series_id", seriesId);
  const rows = (data ?? []) as unknown as { completed_at: string | null; updated_at: string; episodes: { number: number } }[];
  const completed = new Set(rows.filter((r) => r.completed_at).map((r) => r.episodes.number));
  const latest = rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  return { completed, lastStarted: latest ? latest.episodes.number : null };
}
