// A viewer picks a choice in a story episode. Free choices just record their flag; premium ones are paid with
// Ping once (buy_story_choice), then free on replays. The price and the flag come from the published story,
// never from the browser.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { trackEvent } from "@/lib/events";
import { allow } from "@/lib/security/rate-limit";
import { err, readJson, sameOrigin } from "@/lib/security/request";
import { getSessionViewer } from "@/lib/session";
import { sceneOf } from "@/lib/story/engine";
import { playableEpisode, remember } from "@/lib/story/server";
import { choiceKey } from "@/lib/story/types";
import { db } from "@/lib/supabase";
import { getBalance } from "@/lib/wallet";

export const runtime = "nodejs";

const ID = /^[a-z0-9_-]{1,40}$/i;

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return err(403, "forbidden");
  const viewer = await getSessionViewer();
  if (!viewer) return err(401, "signed_out");
  if (!(await allow(`story-choice:${viewer.id}`, 60, 60))) return err(429, "slow_down");

  const body = await readJson<{ episodeId?: string; sceneId?: string; choiceId?: string }>(req);
  if (!body?.episodeId || !ID.test(body.sceneId ?? "") || !ID.test(body.choiceId ?? "")) return err(400, "bad_request");
  const ep = await playableEpisode(viewer.id, body.episodeId);
  if (!ep) return err(404, "not_found");
  const scene = sceneOf(ep.story, body.sceneId);
  const choice = scene?.route.type === "choices" ? scene.route.options.find((c) => c.id === body.choiceId) : undefined;
  if (!scene || !choice) return err(404, "not_found");

  let result: "ok" | "already" | "insufficient" | "free" = "free";
  if (choice.price > 0) {
    const key = choiceKey(ep.id, scene.id, choice.id);
    const { data, error } = await db().rpc("buy_story_choice", { p_viewer: viewer.id, p_series: ep.seriesId, p_key: key, p_price: choice.price });
    if (error) return err(500, "error");
    result = data as "ok" | "already" | "insufficient";
    if (result === "insufficient") return NextResponse.json({ result, balance: await getBalance(viewer.id), price: choice.price });
    if (result === "ok") {
      await trackEvent({ viewerHmac: viewer.phoneHmac, name: "story_choice_bought", seriesId: ep.seriesId, episodeNumber: ep.number, props: { coins: choice.price, scene: scene.id, choice: choice.id } });
    }
  }
  await remember(viewer.id, ep.seriesId, { flag: choice.sets });
  return NextResponse.json({ result, balance: await getBalance(viewer.id), flag: choice.sets });
}
