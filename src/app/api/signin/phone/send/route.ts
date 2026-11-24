// Phone sign-in, step 1: send a 6-digit code to the number (Prelude). Limits: 5 sends per number an hour and
// 15 per network an hour, on top of Prelude's own fraud checks. Never says whether the number has an account.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { phoneHmac } from "@/lib/bot/deps-supabase";
import { allow, clientIp } from "@/lib/security/rate-limit";
import { err, readJson, sameOrigin } from "@/lib/security/request";
import { callingCode, maskPhone, normalizePhone } from "@/lib/signin/doors";
import { sendPhoneCode } from "@/lib/signin/prelude";
import { currentTenantId, db } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return err(403, "forbidden");
  const body = await readJson<{ phone?: string; lang?: string }>(req);
  const e164 = normalizePhone(body?.phone, callingCode(req.headers.get("x-vercel-ip-country")));
  if (!e164) return err(400, "invalid_number");
  const ip = clientIp(req.headers);
  const hmac = phoneHmac(e164.slice(1));
  if (!(await allow(`signin-phone-ip:${ip}`, 15, 3600)) || !(await allow(`signin-phone:${hmac}`, 5, 3600))) return err(429, "slow_down");
  const tenantId = await currentTenantId();
  const { data: existing } = await db().from("viewers").select("id").eq("tenant_id", tenantId).eq("phone_hmac", hmac).maybeSingle();
  const r = await sendPhoneCode(e164, { ip, userAgent: req.headers.get("user-agent"), locale: body?.lang === "en" ? "en" : "ar", existing: Boolean(existing) });
  if (!r.ok) return err(r.reason === "slow_down" ? 429 : r.reason === "not_configured" ? 404 : 400, r.reason);
  return NextResponse.json({ ok: true, phone: e164, shown: maskPhone(e164) }, { headers: { "Cache-Control": "no-store" } });
}
