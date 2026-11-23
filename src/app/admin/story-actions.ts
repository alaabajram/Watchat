"use server";

// Story builder (Admin → Series → Story builder): series kind and style, characters, each episode's scenes
// (draft → publish), and uploads for scene pictures, clips and sound. Everything is checked here again:
// the browser's story is sanitised, media links are rebuilt from their stored paths, Publish runs the same
// validator the builder shows.

import { revalidatePath } from "next/cache";
import { audit, requireAdmin } from "@/lib/admin/auth";
import { randomToken } from "@/lib/crypto";
import { publicUrlFor, uploadTarget } from "@/lib/storage/cloudflare";
import type { UploadTarget } from "@/lib/storage/refs";
import { flagsSetIn } from "@/lib/story/engine";
import { sanitizeCharacters, sanitizeStory, withUrls } from "@/lib/story/sanitize";
import { STORY_STYLES, STORY_UPLOADS, type Character, type StoryGraph, type StoryStyle } from "@/lib/story/types";
import { hasErrors, validateStory, type StoryIssue } from "@/lib/story/validate";
import { db } from "@/lib/supabase";

const UUID = /^[0-9a-f-]{36}$/;

async function ownSeries(tenantId: string, seriesId: string) {
  if (!UUID.test(seriesId)) throw new Error("Series not found.");
  const { data } = await db().from("series").select("id, code, status, format, story_characters").eq("tenant_id", tenantId).eq("id", seriesId).maybeSingle();
  if (!data) throw new Error("Series not found.");
  return data;
}

async function ownEpisode(tenantId: string, episodeId: string) {
  if (!UUID.test(episodeId)) throw new Error("Episode not found.");
  const { data } = await db().from("episodes").select("id, number, series_id, status, story_version").eq("id", episodeId).maybeSingle();
  if (!data) throw new Error("Episode not found.");
  const series = await ownSeries(tenantId, data.series_id);
  return { ep: data, series };
}

/** Scene files live in "<CODE>/story/…" (R2 / Supabase) or Cloudflare Images. */
const pathCheck = (code: string) => (path: string) => path.startsWith("cfimg:") || (path.startsWith("r2:") ? path.slice(3) : path).startsWith(`${code}/story/`);

const clean = (raw: unknown, code: string): StoryGraph => withUrls(sanitizeStory(raw), publicUrlFor, pathCheck(code));

/** Video episodes or a story series, and the story's look. */
export async function setStoryFormat(seriesId: string, format: "video" | "story", style: StoryStyle): Promise<void> {
  const admin = await requireAdmin("content");
  await ownSeries(admin.tenantId, seriesId);
  const st = STORY_STYLES.find((x) => x.key === style)?.key ?? "visual_novel";
  // Stories play on the web only: no episodes sent in the chat.
  const patch = format === "story" ? { format: "story", story_style: st, wa_episode_count: 0 } : { format: "video", story_style: st };
  await db().from("series").update(patch).eq("id", seriesId).eq("tenant_id", admin.tenantId);
  await audit(admin, "series.story_format", "series", seriesId, patch);
  revalidatePath(`/admin/series/${seriesId}`);
}

export async function saveCharacters(seriesId: string, raw: unknown): Promise<Character[]> {
  const admin = await requireAdmin("content");
  const s = await ownSeries(admin.tenantId, seriesId);
  const characters = withUrls(sanitizeCharacters(raw), publicUrlFor, pathCheck(s.code));
  await db().from("series").update({ story_characters: characters }).eq("id", seriesId).eq("tenant_id", admin.tenantId);
  return characters;
}

/** Save the builder's draft (nothing changes for viewers until Publish). */
export async function saveStoryDraft(episodeId: string, raw: unknown): Promise<{ story: StoryGraph; savedAt: string }> {
  const admin = await requireAdmin("content");
  const { series } = await ownEpisode(admin.tenantId, episodeId);
  const story = clean(raw, series.code);
  const savedAt = new Date().toISOString();
  await db().from("episodes").update({ story_draft: story }).eq("id", episodeId);
  return { story, savedAt };
}

/** Publish the draft: viewers play this version from now on. Refused while the checks show errors. */
export async function publishStory(episodeId: string, raw: unknown): Promise<{ ok: boolean; issues: StoryIssue[]; version?: number; live?: boolean }> {
  const admin = await requireAdmin("content");
  const { ep, series } = await ownEpisode(admin.tenantId, episodeId);
  const story = clean(raw, series.code);
  const { data: others } = await db().from("episodes").select("id, story_draft, story").eq("series_id", series.id);
  const graphs = (others ?? []).flatMap((o) => [o.id === episodeId ? story : o.story_draft, o.story]).filter(Boolean).map((g) => sanitizeStory(g));
  const issues = validateStory(story, { flagsKnown: flagsSetIn(graphs), characters: sanitizeCharacters(series.story_characters) });
  if (hasErrors(issues)) return { ok: false, issues };

  const version = (ep.story_version ?? 0) + 1;
  // Publishing an episode's story also opens it to viewers (live with a live series, otherwise with it when it goes live).
  const status = ep.status === "draft" || ep.status === "in_review" ? (series.status === "live" ? "live" : "in_review") : ep.status;
  await db().from("episodes").update({ story_draft: story, story, story_version: version, status }).eq("id", episodeId);
  await audit(admin, "episode.story_published", "episode", episodeId, { version, scenes: story.scenes.length });
  revalidatePath(`/admin/series/${series.id}`);
  return { ok: true, issues, version, live: status === "live" };
}

/** Take a published episode back to hidden (its story is kept as the draft). */
export async function unpublishStory(episodeId: string): Promise<void> {
  const admin = await requireAdmin("content");
  const { series } = await ownEpisode(admin.tenantId, episodeId);
  await db().from("episodes").update({ story: null, status: "draft" }).eq("id", episodeId);
  await audit(admin, "episode.story_unpublished", "episode", episodeId);
  revalidatePath(`/admin/series/${series.id}`);
}

export async function addStoryEpisode(seriesId: string): Promise<{ id: string; number: number }> {
  const admin = await requireAdmin("content");
  await ownSeries(admin.tenantId, seriesId);
  const { data: last } = await db().from("episodes").select("number").eq("series_id", seriesId).order("number", { ascending: false }).limit(1).maybeSingle();
  const number = (last?.number ?? 0) + 1;
  const { data, error } = await db()
    .from("episodes")
    .insert({ series_id: seriesId, number, title_ar: `الحلقة ${number}`, title_en: `Episode ${number}`, status: "draft" })
    .select("id, number")
    .single();
  if (error || !data) throw new Error("Couldn't add the episode.");
  await audit(admin, "episodes.added", "series", seriesId, { numbers: [number], via: "story" });
  return data;
}

export async function renameStoryEpisode(episodeId: string, titleAr: string, titleEn: string): Promise<void> {
  const admin = await requireAdmin("content");
  await ownEpisode(admin.tenantId, episodeId);
  await db()
    .from("episodes")
    .update({ title_ar: titleAr.trim().slice(0, 200) || null, title_en: titleEn.trim().slice(0, 200) || null })
    .eq("id", episodeId);
}

/** Where the browser sends a scene file (pictures → Cloudflare Images, clips and sound → R2; Supabase until set up). */
export async function createStoryUpload(seriesId: string, mime: string, size: number): Promise<UploadTarget> {
  const admin = await requireAdmin("content");
  const s = await ownSeries(admin.tenantId, seriesId);
  const type = STORY_UPLOADS[mime];
  if (!type) throw new Error("Use JPG, PNG or WebP pictures, MP4 clips, and MP3 or M4A sound.");
  if (size > type.maxMb * 1048576) throw new Error(`Too big: ${type.type === "image" ? "pictures" : type.type === "video" ? "clips" : "sound files"} up to ${type.maxMb} MB.`);
  return uploadTarget(`${s.code}/story/${Date.now()}-${randomToken(6)}.${type.ext}`);
}

/** The public link of an uploaded scene file (only for this series' files). */
export async function storyFileUrl(seriesId: string, path: string): Promise<string> {
  const admin = await requireAdmin("content");
  const s = await ownSeries(admin.tenantId, seriesId);
  const url = pathCheck(s.code)(path) && !path.includes("..") ? publicUrlFor(path) : null;
  if (!url) throw new Error("Bad upload.");
  return url;
}
