// Unlock one episode with Ping.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { trackEvent } from "@/lib/events";
import { allow } from "@/lib/security/rate-limit";
import { err, readJson, sameOrigin } from "@/lib/security/request";
import { getSessionViewer } from "@/lib/session";
import { hasAllAccess } from "@/lib/content";
import { db } from "@/lib/supabase";
import { getBalance, unlockEpisode } from "@/lib/wallet";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return err(403, "forbidden");
  const viewer = await getSessionViewer();
  if (!viewer) return err(401, "signed_out");
  if (!(await allow(`unlock:${viewer.id}`, 20, 60))) return err(429, "slow_down");

  const body = await readJson<{ episodeId?: string }>(req);
  if (!body?.episodeId || !/^[0-9a-f-]{36}$/.test(body.episodeId)) return err(400, "bad_request");

  const { data: ep } = await db()
    .from("episodes")
    .select("id, number, coin_price_override, series_id, series!inner(coins_per_episode, free_web_until_ep, status)")
    .eq("id", body.episodeId)
    .eq("status", "live")
    .maybeSingle();
  if (!ep) return err(404, "not_found");
  const series = (ep as unknown as { series: { coins_per_episode: number; free_web_until_ep: number; status: string } }).series;
  if (series.status !== "live") return err(404, "not_found");
  if (ep.number <= series.free_web_until_ep) return NextResponse.json({ result: "already" });

  // Weekly / yearly pass holders never spend Ping.
  if (await hasAllAccess(viewer.id)) return NextResponse.json({ result: "already" });
  // The price always comes from the database, never from the browser.
  const price = ep.coin_price_override ?? series.coins_per_episode;
  const result = await unlockEpisode(viewer.id, ep.series_id, ep.number, price);
  if (result === "ok") {
    await trackEvent({ viewerHmac: viewer.phoneHmac, name: "episode_unlocked", seriesId: ep.series_id, episodeNumber: ep.number, props: { coins: price } });
  }
  return NextResponse.json({ result, balance: await getBalance(viewer.id), price });
}
