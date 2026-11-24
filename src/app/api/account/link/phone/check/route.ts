// "Add a phone number", step 2: the code proves the number; it joins this account — or, if it already opens
// another account, the answer asks to merge the two (nothing changes until the viewer confirms).

import { NextResponse, type NextRequest } from "next/server";
import { phoneHmac } from "@/lib/bot/deps-supabase";
import { allow, clientIp } from "@/lib/security/rate-limit";
import { err, readJson, sameOrigin } from "@/lib/security/request";
import { getSessionViewer } from "@/lib/session";
import { addLogin } from "@/lib/signin/accounts";
import { maskPhone, normalizePhone } from "@/lib/signin/doors";
import { checkPhoneCode } from "@/lib/signin/prelude";
import { currentTenantId } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return err(403, "forbidden");
  const viewer = await getSessionViewer();
  if (!viewer) return err(401, "signed_out");
  const body = await readJson<{ phone?: string; code?: string }>(req);
  const e164 = normalizePhone(body?.phone);
  const code = String(body?.code ?? "").replace(/\D/g, "");
  if (!e164 || code.length < 4 || code.length > 8) return err(400, "wrong_code");
  const hmac = phoneHmac(e164.slice(1));
  if (!(await allow(`signin-check-ip:${clientIp(req.headers)}`, 30, 600)) || !(await allow(`signin-check:${hmac}`, 8, 600))) return err(429, "slow_down");
  const r = await checkPhoneCode(e164, code);
  if (!r.ok) return err(r.reason === "slow_down" ? 429 : 400, r.reason);
  const res = await addLogin(await currentTenantId(), viewer.id, { hmac, kind: "phone", label: maskPhone(e164) });
  if ("error" in res) return err(409, "use_telegram");
  return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
}
