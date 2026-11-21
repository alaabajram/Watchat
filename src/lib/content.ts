// Read-side helpers for the web player.

import { ipMarket, seriesLicensed } from "./economy/store";
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
      "id, code, title_ar, title_en, synopsis_ar, synopsis_en, poster_url, banner_wide_url, free_web_until_ep, paywall_ep, coins_per_episode, season_pass_price_aed, season_pass_price_sar, license_countries",
    )
    .eq("tenant_id", tenantId)
    .eq("code", code.toUpperCase())
    .eq("status", "live")
    .maybeSingle();
  if (!data) return null;
  if (!seriesLicensed(data.license_countries, await ipMarket())) return null; // geo-fenced: not licensed here
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

/** An active weekly / yearly pass opens every series. */
export async function hasAllAccess(viewerId: string): Promise<boolean> {
  const { data } = await db().rpc("has_all_access", { p_viewer: viewerId });
  return data === true;
}

export async function getUnlocked(viewerId: string, seriesId: string): Promise<{ all: boolean; episodes: Set<number> }> {
  const [{ data }, allAccess] = await Promise.all([
    db().from("entitlements").select("episode_number").eq("viewer_id", viewerId).eq("series_id", seriesId),
    hasAllAccess(viewerId),
  ]);
  const rows = data ?? [];
  return {
    all: allAccess || rows.some((r) => r.episode_number === null),
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

export type LibraryItem = {
  code: string;
  titleAr: string;
  titleEn: string;
  posterUrl: string | null;
  bannerWideUrl: string | null;
  total: number;
  resume: number | null; // episode to continue from; null = finished
  lastWatchedAt: string;
};

/** "My account": the viewer's series, most recently watched first, plus the rest of the live catalogue. */
export async function getLibrary(viewerId: string): Promise<{ watching: LibraryItem[]; more: Omit<LibraryItem, "resume" | "lastWatchedAt">[] }> {
  const tenantId = await currentTenantId();
  const now = new Date().toISOString();
  const [{ data: catalog }, { data: rows }] = await Promise.all([
    db()
      .from("series")
      .select("id, code, title_ar, title_en, poster_url, banner_wide_url, created_at, license_countries, episodes(number, status, release_at)")
      .eq("tenant_id", tenantId)
      .eq("status", "live")
      .order("created_at", { ascending: false }),
    db().from("progress").select("completed_at, updated_at, episodes!inner(number, series_id)").eq("viewer_id", viewerId),
  ]);
  type Row = { completed_at: string | null; updated_at: string; episodes: { number: number; series_id: string } };
  const bySeries = new Map<string, Row[]>();
  for (const r of (rows ?? []) as unknown as Row[]) {
    const list = bySeries.get(r.episodes.series_id) ?? [];
    list.push(r);
    bySeries.set(r.episodes.series_id, list);
  }
  const watching: LibraryItem[] = [];
  const more: Omit<LibraryItem, "resume" | "lastWatchedAt">[] = [];
  const market = await ipMarket();
  for (const s of (catalog ?? []).filter((c) => seriesLicensed(c.license_countries, market))) {
    const eps = ((s.episodes ?? []) as { number: number; status: string; release_at: string | null }[]).filter(
      (e) => e.status === "live" && (!e.release_at || e.release_at <= now),
    );
    const base = { code: s.code, titleAr: s.title_ar, titleEn: s.title_en, posterUrl: s.poster_url, bannerWideUrl: s.banner_wide_url, total: eps.length };
    const mine = bySeries.get(s.id);
    if (!mine?.length) {
      more.push(base);
      continue;
    }
    const latest = [...mine].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
    const n = latest.episodes.number;
    const next = latest.completed_at ? n + 1 : n;
    watching.push({ ...base, resume: next <= eps.length ? next : null, lastWatchedAt: latest.updated_at });
  }
  watching.sort((a, b) => b.lastWatchedAt.localeCompare(a.lastWatchedAt));
  return { watching, more };
}

export type HomeSeries = {
  code: string;
  titleAr: string;
  titleEn: string;
  taglineAr: string | null;
  taglineEn: string | null;
  posterUrl: string | null;
  bannerUrl: string | null; // wide banner, falling back to the poster
  genres: string[];
  total: number;
  createdAt: string;
};

export type HomeWatching = HomeSeries & { resume: number | null; lastWatchedAt: string };

/** Home screen: live catalogue (newest first) with genres and artwork, plus this viewer's "continue watching". */
export async function getHome(viewerId: string): Promise<{ catalogue: HomeSeries[]; watching: HomeWatching[] }> {
  const tenantId = await currentTenantId();
  const now = new Date().toISOString();
  const [{ data: catalog }, { data: rows }] = await Promise.all([
    db()
      .from("series")
      .select("id, code, title_ar, title_en, tagline_ar, tagline_en, poster_url, banner_wide_url, genres, created_at, license_countries, episodes(number, status, release_at)")
      .eq("tenant_id", tenantId)
      .eq("status", "live")
      .order("created_at", { ascending: false }),
    db().from("progress").select("completed_at, updated_at, episodes!inner(number, series_id)").eq("viewer_id", viewerId),
  ]);
  type Row = { completed_at: string | null; updated_at: string; episodes: { number: number; series_id: string } };
  const latestBySeries = new Map<string, Row>();
  for (const r of (rows ?? []) as unknown as Row[]) {
    const prev = latestBySeries.get(r.episodes.series_id);
    if (!prev || r.updated_at > prev.updated_at) latestBySeries.set(r.episodes.series_id, r);
  }
  const catalogue: HomeSeries[] = [];
  const watching: HomeWatching[] = [];
  const market = await ipMarket();
  for (const s of (catalog ?? []).filter((c) => seriesLicensed(c.license_countries, market))) {
    const total = ((s.episodes ?? []) as { status: string; release_at: string | null }[]).filter(
      (e) => e.status === "live" && (!e.release_at || e.release_at <= now),
    ).length;
    if (total === 0) continue;
    const item: HomeSeries = {
      code: s.code,
      titleAr: s.title_ar,
      titleEn: s.title_en,
      taglineAr: s.tagline_ar ?? null,
      taglineEn: s.tagline_en ?? null,
      posterUrl: s.poster_url,
      bannerUrl: s.banner_wide_url ?? s.poster_url,
      genres: (s.genres as string[] | null) ?? [],
      total,
      createdAt: s.created_at,
    };
    catalogue.push(item);
    const latest = latestBySeries.get(s.id);
    if (latest) {
      const n = latest.episodes.number;
      const next = latest.completed_at ? n + 1 : n;
      watching.push({ ...item, resume: next <= total ? next : null, lastWatchedAt: latest.updated_at });
    }
  }
  watching.sort((a, b) => b.lastWatchedAt.localeCompare(a.lastWatchedAt));
  return { catalogue, watching };
}
