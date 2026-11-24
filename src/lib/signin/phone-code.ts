// Sending a phone code (Prelude) with the shared limits: used by sign-in and by "add a phone number".

import { NextResponse, type NextRequest } from "next/server";
import { phoneHmac } from "../bot/deps-supabase";
import { allow, clientIp } from "../security/rate-limit";
import { err } from "../security/request";
import { currentTenantId, db } from "../supabase";
import { callingCode, maskPhone, normalizePhone } from "./doors";
import { sendPhoneCode } from "./prelude";

export async function sendCode(req: NextRequest, body: { phone?: string; lang?: string } | null) {
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
