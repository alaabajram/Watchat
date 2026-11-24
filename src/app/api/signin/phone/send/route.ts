// Phone sign-in, step 1: send a 6-digit code to the number (Prelude). Limits: 5 sends per number an hour and
// 15 per network an hour, on top of Prelude's own fraud checks. Never says whether the number has an account.

import type { NextRequest } from "next/server";
import { err, readJson, sameOrigin } from "@/lib/security/request";
import { sendCode } from "@/lib/signin/phone-code";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return err(403, "forbidden");
  return sendCode(req, await readJson<{ phone?: string; ref?: string; lang?: string }>(req));
}
