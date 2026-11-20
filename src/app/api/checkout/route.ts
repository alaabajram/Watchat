// Start a purchase (coin pack or season pass). Needs a trusted device.
// Online (Tap) when TAP_SECRET_KEY is set; otherwise a manual cash / transfer order with a reference code.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { trackEvent } from "@/lib/events";
import { allow } from "@/lib/security/rate-limit";
import { err, readJson, sameOrigin } from "@/lib/security/request";
import { getSessionViewer } from "@/lib/session";
import { paymentMode, startCashOrder, startCheckout, type CheckoutItem } from "@/lib/wallet";

export const runtime = "nodejs";

type Body = { type?: "coin_pack" | "season_pass"; id?: string; returnTo?: string };

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return err(403, "forbidden");
  const viewer = await getSessionViewer();
  if (!viewer) return err(401, "signed_out");
  if (!viewer.trusted) return err(409, "confirm_device");
  if (!(await allow(`checkout:${viewer.id}`, 10, 3600))) return err(429, "slow_down");

  const body = await readJson<Body>(req);
  if (!body?.id || !/^[0-9a-f-]{36}$/.test(body.id) || (body.type !== "coin_pack" && body.type !== "season_pass")) {
    return err(400, "bad_request");
  }
  const item: CheckoutItem = body.type === "coin_pack" ? { type: "coin_pack", packId: body.id } : { type: "season_pass", seriesId: body.id };
  // Only allow returning to our own pages.
  const returnTo = body.returnTo && body.returnTo.startsWith("/") && !body.returnTo.startsWith("//") ? body.returnTo : "/wallet";

  try {
    if (paymentMode() === "cash") {
      const order = await startCashOrder({ viewerId: viewer.id, country: viewer.country, item });
      await trackEvent({
        viewerHmac: viewer.phoneHmac,
        name: "order_requested",
        props: { order_id: order.orderId, item: item.type, amount: order.amount, currency: order.currency, method: "cash" },
      });
      return NextResponse.json({ pending: true, reference: order.reference, amount: order.amount, currency: order.currency });
    }
    const { url } = await startCheckout({ viewerId: viewer.id, country: viewer.country, item, returnTo });
    return NextResponse.json({ url });
  } catch (e) {
    if (e instanceof Error && e.message === "too_many_pending") return err(409, "too_many_pending");
    console.error("[checkout] failed", e);
    return err(400, "checkout_failed");
  }
}
