// A code typed in the store: free-Ping codes are redeemed now; discount / bonus codes are kept for checkout.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { redeemCode } from "@/lib/economy/rewards";
import { viewerMarket } from "@/lib/economy/store";
import { trackEvent } from "@/lib/events";
import { allow } from "@/lib/security/rate-limit";
import { err, readJson, sameOrigin } from "@/lib/security/request";
import { getSessionViewer } from "@/lib/session";
import { currentTenantId, db } from "@/lib/supabase";
import { getBalance } from "@/lib/wallet";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return err(403, "forbidden");
  const viewer = await getSessionViewer();
  if (!viewer) return err(401, "signed_out");
  // Codes are guessable by brute force otherwise.
  if (!(await allow(`code:${viewer.id}`, 8, 3600))) return err(429, "slow_down");
  const body = await readJson<{ code?: string }>(req);
  const code = String(body?.code ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{3,20}$/.test(code)) return NextResponse.json({ result: "invalid" });
  const tenantId = await currentTenantId();
  const { data: promo } = await db().from("promotions").select("kind, active").eq("tenant_id", tenantId).eq("code", code).maybeSingle();
  if (promo && promo.active && promo.kind !== "free_ping") return NextResponse.json({ result: "checkout" });
  const market = await viewerMarket(viewer);
  const r = await redeemCode(viewer.id, tenantId, code, market.country);
  if (r.result === "ok") await trackEvent({ viewerHmac: viewer.phoneHmac, name: "promo_redeemed", props: { ping: r.ping } });
  return NextResponse.json({ ...r, balance: await getBalance(viewer.id) });
}
