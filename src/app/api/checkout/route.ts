// Start a Tap checkout for a coin pack or a season pass. Needs a trusted device.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { tapConfigured } from "@/lib/payments/tap";
import { allow } from "@/lib/security/rate-limit";
import { err, readJson, sameOrigin } from "@/lib/security/request";
import { getSessionViewer } from "@/lib/session";
import { startCheckout } from "@/lib/wallet";

export const runtime = "nodejs";

type Body = { type?: "coin_pack" | "season_pass"; id?: string; returnTo?: string };

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return err(403, "forbidden");
  const viewer = await getSessionViewer();
  if (!viewer) return err(401, "signed_out");
  if (!viewer.trusted) return err(409, "confirm_device");
  if (!tapConfigured()) return err(503, "payments_not_configured");
  if (!(await allow(`checkout:${viewer.id}`, 10, 3600))) return err(429, "slow_down");

  const body = await readJson<Body>(req);
  if (!body?.id || !/^[0-9a-f-]{36}$/.test(body.id) || (body.type !== "coin_pack" && body.type !== "season_pass")) {
    return err(400, "bad_request");
  }
  // Only allow returning to our own pages.
  const returnTo = body.returnTo && body.returnTo.startsWith("/") && !body.returnTo.startsWith("//") ? body.returnTo : "/wallet";

  try {
    const { url } = await startCheckout({
      viewerId: viewer.id,
      country: viewer.country,
      item: body.type === "coin_pack" ? { type: "coin_pack", packId: body.id } : { type: "season_pass", seriesId: body.id },
      returnTo,
    });
    return NextResponse.json({ url });
  } catch (e) {
    console.error("[checkout] failed", e);
    return err(400, "checkout_failed");
  }
}
