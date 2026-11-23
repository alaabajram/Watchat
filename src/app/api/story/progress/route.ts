// Where a viewer is in a story episode (resume), and the end of it: marks the episode complete (continue
// watching, the bot's "On the web" flow) and remembers a named ending.

import type { NextRequest } from "next/server";
import { after, NextResponse } from "next/server";
import { trackEvent } from "@/lib/events";
import { onWebWatch } from "@/lib/flows/web-trigger";
import { allow } from "@/lib/security/rate-limit";
import { err, readJson, sameOrigin } from "@/lib/security/request";
import { getSessionViewer } from "@/lib/session";
import { sceneOf } from "@/lib/story/engine";
import { playableEpisode, remember } from "@/lib/story/server";
import { db } from "@/lib/supabase";

export const runtime = "nodejs";

type Body = { episodeId?: string; sceneId?: string; history?: unknown; ended?: boolean; ending?: string | null };

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return err(403, "forbidden");
  const viewer = await getSessionViewer();
  if (!viewer) return err(401, "signed_out");
  if (!(await allow(`story-progress:${viewer.sessionId}`, 60, 60))) return err(429, "slow_down");

  const body = await readJson<Body>(req);
  if (!body?.episodeId) return err(400, "bad_request");
  const ep = await playableEpisode(viewer.id, body.episodeId);
  if (!ep) return err(404, "not_found");
  const scene = sceneOf(ep.story, body.sceneId);
  if (!scene) return err(400, "bad_request");
  const history = (Array.isArray(body.history) ? body.history : []).filter((h): h is string => typeof h === "string" && Boolean(sceneOf(ep.story, h))).slice(-300);
  const now = new Date().toISOString();

  await db()
    .from("story_progress")
    .upsert({ viewer_id: viewer.id, episode_id: ep.id, series_id: ep.seriesId, scene_id: body.ended ? (ep.story.start ?? scene.id) : scene.id, history, updated_at: now }, { onConflict: "viewer_id,episode_id" });

  // Same "progress" row as video episodes: continue watching and completion work for both.
  const { data: existing } = await db().from("progress").select("completed_at").eq("viewer_id", viewer.id).eq("episode_id", ep.id).maybeSingle();
  const completes = Boolean(body.ended) && !existing?.completed_at;
  await db()
    .from("progress")
    .upsert(
      { viewer_id: viewer.id, episode_id: ep.id, position_s: body.ended ? 0 : history.length, completed_at: existing?.completed_at ?? (body.ended ? now : null), updated_at: now },
      { onConflict: "viewer_id,episode_id" },
    );
  if (body.ended && scene.route.type === "end" && scene.route.ending && body.ending === scene.id) await remember(viewer.id, ep.seriesId, { ending: scene.id });
  if (completes) await trackEvent({ viewerHmac: viewer.phoneHmac, name: "episode_completed", seriesId: ep.seriesId, episodeNumber: ep.number });

  after(async () => {
    try {
      await onWebWatch(viewer.id, ep.seriesId);
    } catch (e) {
      console.error("[story progress] web trigger failed", e instanceof Error ? e.message : e);
    }
  });
  return NextResponse.json({ ok: true });
}
