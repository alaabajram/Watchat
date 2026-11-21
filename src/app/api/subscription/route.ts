// Viewer: stop or restart automatic renewal of their weekly / yearly pass.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { setAutoRenew } from "@/lib/economy/billing";
import { trackEvent } from "@/lib/events";
import { allow } from "@/lib/security/rate-limit";
import { err, readJson, sameOrigin } from "@/lib/security/request";
import { getSessionViewer } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return err(403, "forbidden");
  const viewer = await getSessionViewer();
  if (!viewer) return err(401, "signed_out");
  if (!(await allow(`sub:${viewer.id}`, 10, 3600))) return err(429, "slow_down");
  const body = await readJson<{ autoRenew?: boolean }>(req);
  if (typeof body?.autoRenew !== "boolean") return err(400, "bad_request");
  const ok = await setAutoRenew(viewer.id, body.autoRenew);
  if (ok) await trackEvent({ viewerHmac: viewer.phoneHmac, name: body.autoRenew ? "pass_renew_on" : "pass_renew_off", props: {} });
  return NextResponse.json({ ok });
}
