// Player heartbeat: saves where the viewer is in an episode (every ~10 s) and marks it complete at 90%.

import type { NextRequest } from "next/server";
import { after, NextResponse } from "next/server";
import { onWebWatch } from "@/lib/flows/web-trigger";
import { trackEvent } from "@/lib/events";
import { allow } from "@/lib/security/rate-limit";
import { err, readJson, sameOrigin } from "@/lib/security/request";
import { getSessionViewer } from "@/lib/session";
import { db } from "@/lib/supabase";

export const runtime = "nodejs";

type Body = { episodeId?: string; position?: number; duration?: number; ended?: boolean };

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return err(403, "forbidden");
  const viewer = await getSessionViewer();
  if (!viewer) return err(401, "signed_out");
  if (!(await allow(`progress:${viewer.sessionId}`, 30, 60))) return err(429, "slow_down");

  const body = await readJson<Body>(req);
  const episodeId = body?.episodeId;
  const position = Math.max(0, Math.floor(Number(body?.position ?? 0)));
  const duration = Math.max(0, Math.floor(Number(body?.duration ?? 0)));
  if (!episodeId || !/^[0-9a-f-]{36}$/.test(episodeId)) return err(400, "bad_request");

  const { data: episode } = await db().from("episodes").select("id, number, series_id").eq("id", episodeId).maybeSingle();
  if (!episode) return err(404, "not_found");

  const { data: existing } = await db()
    .from("progress")
    .select("completed_at")
    .eq("viewer_id", viewer.id)
    .eq("episode_id", episodeId)
    .maybeSingle();

  const completes = Boolean(body?.ended) || (duration > 0 && position / duration >= 0.9);
  const completedAt = existing?.completed_at ?? (completes ? new Date().toISOString() : null);

  await db().from("progress").upsert(
    {
      viewer_id: viewer.id,
      episode_id: episodeId,
      position_s: position,
      completed_at: completedAt,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "viewer_id,episode_id" },
  );

  if (completes && !existing?.completed_at) {
    await trackEvent({
      viewerHmac: viewer.phoneHmac,
      name: "episode_completed",
      seriesId: episode.series_id,
      episodeNumber: episode.number,
    });
  }
  // The bot follows what the viewer watches: this series becomes active and its "On the web" flow can run.
  after(async () => {
    try {
      await onWebWatch(viewer.id, episode.series_id);
    } catch (e) {
      console.error("[progress] web trigger failed", e instanceof Error ? e.message : e);
    }
  });
  return NextResponse.json({ ok: true, completed: Boolean(completedAt) });
}
