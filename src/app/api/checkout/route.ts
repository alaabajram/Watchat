// Start a purchase (Ping pack, series pass, or weekly / monthly / yearly pass). Telegram viewers pay in Telegram Stars. Any signed-in viewer can buy (no device confirm).
// Online (Tap) when TAP_SECRET_KEY is set; otherwise a manual cash / transfer order with a reference code.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { trackEvent } from "@/lib/events";
import { allow } from "@/lib/security/rate-limit";
import { err, readJson, sameOrigin } from "@/lib/security/request";
import { db } from "@/lib/supabase";
import { isTelegram } from "@/lib/telegram/telegram";
import { getSessionViewer } from "@/lib/session";
import { paymentMode, startCashOrder, startCheckout, startStarsCheckout, type CheckoutItem } from "@/lib/wallet";

export const runtime = "nodejs";

type Body = { type?: "coin_pack" | "season_pass" | "subscription"; id?: string; returnTo?: string; code?: string };

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return err(403, "forbidden");
  const viewer = await getSessionViewer();
  if (!viewer) return err(401, "signed_out");
  if (!(await allow(`checkout:${viewer.id}`, 10, 3600))) return err(429, "slow_down");

  const body = await readJson<Body>(req);
  let item: CheckoutItem;
  if (body?.type === "subscription" && (body.id === "weekly" || body.id === "monthly" || body.id === "yearly")) item = { type: "subscription", plan: body.id };
  else if (body?.id && /^[0-9a-f-]{36}$/.test(body.id) && body.type === "coin_pack") item = { type: "coin_pack", packId: body.id };
  else if (body?.id && /^[0-9a-f-]{36}$/.test(body.id) && body.type === "season_pass") item = { type: "season_pass", seriesId: body.id };
  else return err(400, "bad_request");
  const { data: who } = await db().from("viewers").select("phone_e164").eq("id", viewer.id).maybeSingle();
  const code = typeof body.code === "string" && /^[A-Za-z0-9]{3,20}$/.test(body.code.trim()) ? body.code.trim() : null;
  // Only allow returning to our own pages.
  const returnTo = body.returnTo && body.returnTo.startsWith("/") && !body.returnTo.startsWith("//") ? body.returnTo : "/wallet";

  try {
    // Telegram viewers pay in Telegram Stars (Telegram's rule for digital goods): Telegram's own payment sheet.
    if (isTelegram(who?.phone_e164)) {
      const { invoice, orderId } = await startStarsCheckout({ viewerId: viewer.id, item, code });
      await trackEvent({ viewerHmac: viewer.phoneHmac, name: "checkout_started", props: { order_id: orderId, item: item.type, method: "telegram_stars" } });
      return NextResponse.json({ invoice });
    }
    if (item.type === "subscription" && item.plan === "monthly") return err(400, "bad_request"); // Stars only
    if (paymentMode() === "cash") {
      const order = await startCashOrder({ viewerId: viewer.id, country: viewer.country, item, code });
      await trackEvent({
        viewerHmac: viewer.phoneHmac,
        name: "order_requested",
        props: { order_id: order.orderId, item: item.type, amount: order.amount, currency: order.currency, method: "cash" },
      });
      return NextResponse.json({ pending: true, reference: order.reference, amount: order.amount, currency: order.currency });
    }
    const { url } = await startCheckout({ viewerId: viewer.id, country: viewer.country, item, returnTo, code });
    return NextResponse.json({ url });
  } catch (e) {
    if (e instanceof Error && e.message === "too_many_pending") return err(409, "too_many_pending");
    console.error("[checkout] failed", e);
    return err(400, "checkout_failed");
  }
}
