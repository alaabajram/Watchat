// Today: POST { action: "draw" } reveals the card of the day, { action: "question", pick } answers the daily
// question, { action: "sign", sign } saves the viewer's star sign. Each returns the whole Today state.

import { NextResponse, type NextRequest } from "next/server";
import { isSign } from "@/lib/daily/daily";
import { answerQuestion, drawCard, setSign, todayFor } from "@/lib/play/store";
import { allow } from "@/lib/security/rate-limit";
import { err, readJson, sameOrigin } from "@/lib/security/request";
import { getSessionViewer } from "@/lib/session";
import { currentTenantId } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return err(403, "forbidden");
  const viewer = await getSessionViewer();
  if (!viewer) return err(401, "signed_out");
  if (!(await allow(`today:${viewer.id}`, 40, 600))) return err(429, "slow_down");
  const body = await readJson<{ action?: string; pick?: number; sign?: string }>(req);
  const tenantId = await currentTenantId();
  if (body?.action === "draw") return NextResponse.json({ today: await drawCard(tenantId, viewer) });
  if (body?.action === "question") {
    const today = await answerQuestion(tenantId, viewer, Number(body.pick));
    return today ? NextResponse.json({ today }) : err(400, "bad_pick");
  }
  if (body?.action === "sign" && isSign(body.sign)) {
    await setSign(viewer, body.sign);
    return NextResponse.json({ today: await todayFor(tenantId, viewer.id) });
  }
  return err(400, "bad_request");
}
