// Read-side helpers for the web player.

import { originalLang, type EpisodeTracks, type LangKey } from "@/lib/storage/tracks";
import { compactCount, rankByViews } from "./catalogue-meta";
import { sanitizeCharacters, sanitizeStory } from "./story/sanitize";
import { STORY_STYLES, type Character, type StoryGraph, type StoryStyle } from "./story/types";
export { compactCount, rankByViews };
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
  trailerUrl: string | null;
  /** Language spoken in the videos (dubs and subtitles are added for the others). */
  original: LangKey;
  /** "story": episodes are scenes built in the Story builder, played by the story reader. */
  format: "video" | "story";
  storyStyle: StoryStyle;
  storyCharacters: Character[];
};

export type WebEpisode = {
  id: string;
  number: number;
  titleAr: string | null;
  titleEn: string | null;
  streamUid: string | null;
  coinPrice: number | null;
  /** Subtitles / dub attached to the video (the player picks by the viewer's language). */
  tracks: EpisodeTracks;
};

export async function getSeriesByCode(code: string): Promise<WebSeries | null> {
  const tenantId = await currentTenantId();
  const { data } = await db()
    .from("series")
    .select(
      "id, code, title_ar, title_en, synopsis_ar, synopsis_en, poster_url, banner_wide_url, trailer_video_url, dialect, free_web_until_ep, paywall_ep, coins_per_episode, season_pass_price_aed, season_pass_price_sar, license_countries, format, story_style, story_characters",
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
    trailerUrl: data.trailer_video_url ?? null,
    original: originalLang(data.dialect),
    format: data.format === "story" ? "story" : "video",
    storyStyle: (STORY_STYLES.find((x) => x.key === data.story_style)?.key ?? "visual_novel") as StoryStyle,
    storyCharacters: sanitizeCharacters(data.story_characters),
  };
}

/** The published story of one episode (only call it for an episode the viewer may play). */
export async function getEpisodeStory(episodeId: string): Promise<StoryGraph | null> {
  const { data } = await db().from("episodes").select("story").eq("id", episodeId).eq("status", "live").maybeSingle();
  return data?.story ? sanitizeStory(data.story) : null;
}

/** Where the viewer stopped in a story episode. */
export async function getStoryPosition(viewerId: string, episodeId: string): Promise<string | null> {
  const { data } = await db().from("story_progress").select("scene_id").eq("viewer_id", viewerId).eq("episode_id", episodeId).maybeSingle();
  return data?.scene_id ?? null;
}

export async function getEpisodes(seriesId: string): Promise<WebEpisode[]> {
  const { data } = await db()
    .from("episodes")
    .select("id, number, title_ar, title_en, stream_uid, coin_price_override, tracks")
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
    tracks: (e.tracks ?? {}) as EpisodeTracks,
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
export async function getLibrary(viewerId: string): Promise<{ watching: LibraryItem[]; more: Omit<LibraryItem, "resume" | "lastWatchedAt">[]; saved: Omit<LibraryItem, "resume" | "lastWatchedAt">[] }> {
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
  const { data: savedRows } = await db().from("my_list").select("series_id, created_at").eq("viewer_id", viewerId).order("created_at", { ascending: false });
  const savedOrder = new Map((savedRows ?? []).map((r, i) => [r.series_id as string, i]));
  const saved: Omit<LibraryItem, "resume" | "lastWatchedAt">[] = [];
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
    if (savedOrder.has(s.id)) saved[savedOrder.get(s.id)!] = base;
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
  return { watching, more, saved: saved.filter(Boolean) };
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
  /** Episodes planned (released + coming); equal to `total` when the series is complete. */
  planned: number;
  complete: boolean;
  /** Viewers who started it in the last 30 days, and its place in that ranking (1 = most watched; null = no views). */
  views: number;
  rank: number | null;
  /** English available: a dub on some episode, or English subtitles. */
  dub: boolean;
  subs: boolean;
  /** In this viewer's My List. */
  saved: boolean;
};

export type HomeWatching = HomeSeries & { resume: number | null; lastWatchedAt: string };

/** Home screen: live catalogue (newest first) with genres and artwork, plus this viewer's "continue watching". */
export async function getHome(viewerId: string): Promise<{ catalogue: HomeSeries[]; watching: HomeWatching[] }> {
  const tenantId = await currentTenantId();
  const now = new Date().toISOString();
  const [{ data: catalog }, { data: rows }] = await Promise.all([
    db()
      .from("series")
      .select("id, code, title_ar, title_en, tagline_ar, tagline_en, poster_url, banner_wide_url, genres, created_at, license_countries, episodes(number, status, release_at, tracks)")
      .eq("tenant_id", tenantId)
      .eq("status", "live")
      .order("created_at", { ascending: false }),
    db().from("progress").select("completed_at, updated_at, episodes!inner(number, series_id)").eq("viewer_id", viewerId),
  ]);
  const [{ data: pop }, { data: saved }] = await Promise.all([
    db().rpc("series_popularity", { p_tenant: tenantId, p_since: new Date(Date.now() - 30 * 86400_000).toISOString() }),
    db().from("my_list").select("series_id").eq("viewer_id", viewerId),
  ]);
  const views = new Map(((pop ?? []) as { series_id: string; viewers: number }[]).map((p) => [p.series_id, Number(p.viewers)]));
  const ranks = rankByViews(views);
  const savedIds = new Set((saved ?? []).map((r) => r.series_id as string));
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
    const eps = (s.episodes ?? []) as { status: string; release_at: string | null; tracks: EpisodeTracks | null }[];
    const released = eps.filter((e) => e.status === "live" && (!e.release_at || e.release_at <= now));
    const total = released.length;
    if (total === 0) continue;
    const planned = eps.filter((e) => e.status !== "archived").length;
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
      planned: Math.max(planned, total),
      complete: planned <= total,
      views: views.get(s.id) ?? 0,
      rank: ranks.get(s.id) ?? null,
      dub: released.some((e) => e.tracks?.audio?.en?.stream === "attached"),
      subs: released.some((e) => e.tracks?.subs?.en?.stream === "attached"),
      saved: savedIds.has(s.id),
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

/** Save / remove a series in a viewer's My List. Returns whether it's saved now. */
export async function toggleMyList(viewerId: string, seriesCode: string): Promise<boolean | null> {
  const tenantId = await currentTenantId();
  const { data: s } = await db().from("series").select("id").eq("tenant_id", tenantId).eq("code", seriesCode.toUpperCase()).eq("status", "live").maybeSingle();
  if (!s) return null;
  const { data: had } = await db().from("my_list").select("series_id").eq("viewer_id", viewerId).eq("series_id", s.id).maybeSingle();
  if (had) {
    await db().from("my_list").delete().eq("viewer_id", viewerId).eq("series_id", s.id);
    return false;
  }
  await db().from("my_list").insert({ viewer_id: viewerId, series_id: s.id });
  return true;
}

