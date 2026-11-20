// Sign out this device, or every other device.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { err, readJson, sameOrigin } from "@/lib/security/request";
import { getSessionViewer, revokeSessions, SESSION_COOKIE } from "@/lib/session";
import { db } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return err(403, "forbidden");
  const viewer = await getSessionViewer();
  if (!viewer) return err(401, "signed_out");
  const body = await readJson<{ action?: "this" | "others" }>(req);
  if (body?.action === "others") {
    await revokeSessions(viewer.id, viewer.sessionId);
    return NextResponse.json({ ok: true });
  }
  if (body?.action === "this") {
    await db().from("sessions").update({ revoked_at: new Date().toISOString() }).eq("id", viewer.sessionId);
    const res = NextResponse.json({ ok: true });
    res.cookies.delete(SESSION_COOKIE);
    return res;
  }
  return err(400, "bad_request");
}
