// Server side of story playback: load a story episode the viewer may play, their choices and purchases.

import { getUnlocked } from "@/lib/content";
import { db } from "@/lib/supabase";
import { sanitizeStory } from "./sanitize";
import type { StoryGraph } from "./types";

export type PlayableEpisode = { id: string; number: number; seriesId: string; story: StoryGraph };

/** A published story episode of a live story series that this viewer may open (free, unlocked or a pass). */
export async function playableEpisode(viewerId: string, episodeId: string): Promise<PlayableEpisode | null> {
  if (!/^[0-9a-f-]{36}$/.test(episodeId)) return null;
  const { data: ep } = await db()
    .from("episodes")
    .select("id, number, series_id, story, status, series!inner(status, format, free_web_until_ep)")
    .eq("id", episodeId)
    .eq("status", "live")
    .maybeSingle();
  const series = (ep as unknown as { series?: { status: string; format: string; free_web_until_ep: number } } | null)?.series;
  if (!ep || !ep.story || !series || series.status !== "live" || series.format !== "story") return null;
  if (ep.number > series.free_web_until_ep) {
    const unlocked = await getUnlocked(viewerId, ep.series_id);
    if (!unlocked.all && !unlocked.episodes.has(ep.number)) return null;
  }
  return { id: ep.id, number: ep.number, seriesId: ep.series_id, story: sanitizeStory(ep.story) };
}

/** What a viewer chose across a series (flags), the endings they reached and the premium choices they bought. */
export async function storyStateOf(viewerId: string, seriesId: string): Promise<{ flags: string[]; endings: string[]; bought: string[] }> {
  const [{ data: st }, { data: bought }] = await Promise.all([
    db().from("story_state").select("flags, endings").eq("viewer_id", viewerId).eq("series_id", seriesId).maybeSingle(),
    db().from("story_purchases").select("choice_key").eq("viewer_id", viewerId).eq("series_id", seriesId),
  ]);
  return { flags: st?.flags ?? [], endings: st?.endings ?? [], bought: (bought ?? []).map((b) => b.choice_key) };
}

/** Add a flag or an ending to the viewer's story state for this series. */
export async function remember(viewerId: string, seriesId: string, add: { flag?: string | null; ending?: string | null }) {
  if (!add.flag && !add.ending) return;
  const current = await storyStateOf(viewerId, seriesId);
  const flags = add.flag && !current.flags.includes(add.flag) ? [...current.flags, add.flag].slice(-200) : current.flags;
  const endings = add.ending && !current.endings.includes(add.ending) ? [...current.endings, add.ending].slice(-200) : current.endings;
  await db()
    .from("story_state")
    .upsert({ viewer_id: viewerId, series_id: seriesId, flags, endings, updated_at: new Date().toISOString() }, { onConflict: "viewer_id,series_id" });
}
