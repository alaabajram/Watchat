// Phone sign-in, step 2: check the code; on success sign this browser in to the account of that number (the same
// account as its WhatsApp chats), creating it on first visit (welcome Ping).

import type { NextRequest } from "next/server";
import { phoneHmac } from "@/lib/bot/deps-supabase";
import { allow, clientIp } from "@/lib/security/rate-limit";
import { err, readJson, sameOrigin } from "@/lib/security/request";
import { maskPhone } from "@/lib/signin/doors";
import { openPhone, sealPhone } from "@/lib/signin/phone-ref";
import { checkPhoneCode } from "@/lib/signin/prelude";
import { safeNext, SignInRefused, viewerForPhone, withSession } from "@/lib/signin/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return err(403, "forbidden");
  const body = await readJson<{ ref?: string; code?: string; to?: string; lang?: string }>(req);
  const e164 = openPhone(body?.ref);
  const code = String(body?.code ?? "").replace(/\D/g, "");
  if (!e164 || code.length < 4 || code.length > 8) return err(400, "wrong_code");
  if (!(await allow(`signin-check-ip:${clientIp(req.headers)}`, 30, 600)) || !(await allow(`signin-check:${phoneHmac(e164.slice(1))}`, 8, 600))) return err(429, "slow_down");
  const r = await checkPhoneCode(e164, code);
  if (!r.ok) return err(r.reason === "slow_down" ? 429 : 400, r.reason);
  try {
    const v = await viewerForPhone(e164, body?.lang === "en" ? "en" : "ar");
    // The device keeps the masked number and a sealed copy, to offer "Continue as …" next time.
    return withSession(req, v.id, { ok: true, to: safeNext(body?.to), remember: { ref: sealPhone(e164), shown: maskPhone(e164) } });
  } catch (e) {
    if (e instanceof SignInRefused) return err(409, "use_telegram");
    throw e;
  }
}
