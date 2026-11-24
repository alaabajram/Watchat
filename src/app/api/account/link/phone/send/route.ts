// "Add a phone number" (Profile → Sign-in methods), step 1: send a code to the number.

import type { NextRequest } from "next/server";
import { err, readJson, sameOrigin } from "@/lib/security/request";
import { getSessionViewer } from "@/lib/session";
import { sendCode } from "@/lib/signin/phone-code";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return err(403, "forbidden");
  if (!(await getSessionViewer())) return err(401, "signed_out");
  return sendCode(req, await readJson<{ phone?: string; lang?: string }>(req));
}
