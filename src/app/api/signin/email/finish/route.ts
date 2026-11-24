// Email sign-in, step 2 (the "Continue" tap on /signin/email): use the one-time token once, then sign in to the
// account of that email — or a new one (welcome Ping). A tap, not the link itself, so mail scanners that open
// links can't use it up.

import type { NextRequest } from "next/server";
import { sha256Hex } from "@/lib/crypto";
import { allow, clientIp } from "@/lib/security/rate-limit";
import { err, readJson, sameOrigin } from "@/lib/security/request";
import { viewerForEmail, withSession } from "@/lib/signin/server";
import { currentTenantId, db } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return err(403, "forbidden");
  if (!(await allow(`signin-finish-ip:${clientIp(req.headers)}`, 20, 600))) return err(429, "slow_down");
  const body = await readJson<{ token?: string }>(req);
  const token = String(body?.token ?? "");
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return err(400, "expired");
  const tenantId = await currentTenantId();
  // Use it up in one step, so two taps can't both sign in.
  const { data: row } = await db()
    .from("email_logins")
    .update({ used_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("token_hash", sha256Hex(token))
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("email_hmac, next_path, ui_locale")
    .maybeSingle();
  if (!row) return err(400, "expired");
  const v = await viewerForEmail(row.email_hmac, row.ui_locale === "en" ? "en" : "ar");
  return withSession(req, v.id, { ok: true, to: row.next_path ?? "/" });
}
