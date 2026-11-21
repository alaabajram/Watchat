// Claim today's check-in Ping (once per Gulf day; the streak grows day by day up to the 7th).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { claimCheckin } from "@/lib/economy/rewards";
import { trackEvent } from "@/lib/events";
import { allow } from "@/lib/security/rate-limit";
import { err, sameOrigin } from "@/lib/security/request";
import { getSessionViewer } from "@/lib/session";
import { currentTenantId } from "@/lib/supabase";
import { getBalance } from "@/lib/wallet";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return err(403, "forbidden");
  const viewer = await getSessionViewer();
  if (!viewer) return err(401, "signed_out");
  if (!(await allow(`checkin:${viewer.id}`, 10, 3600))) return err(429, "slow_down");
  const r = await claimCheckin(viewer.id, await currentTenantId());
  if (r.ok) await trackEvent({ viewerHmac: viewer.phoneHmac, name: "checkin_claimed", props: { streak: r.streak, ping: r.ping } });
  return NextResponse.json({ ...r, balance: await getBalance(viewer.id) });
}
