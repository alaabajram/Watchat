// "Confirm it's you": proves this browser belongs to the WhatsApp number before any spending.
// POST creates a 6-digit code; the viewer sends "CONFIRM <code>" to the bot from their number;
// GET reports whether this session is now trusted.

import { randomInt } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { allow } from "@/lib/security/rate-limit";
import { err, sameOrigin } from "@/lib/security/request";
import { getSessionViewer } from "@/lib/session";
import { db } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return err(403, "forbidden");
  const viewer = await getSessionViewer();
  if (!viewer) return err(401, "signed_out");
  if (viewer.trusted) return NextResponse.json({ trusted: true });
  if (!(await allow(`confirm:${viewer.sessionId}`, 5, 600))) return err(429, "slow_down");

  // Expire older pending codes for this session, then issue a fresh one.
  await db().from("spend_confirmations").update({ status: "expired" }).eq("session_id", viewer.sessionId).eq("status", "pending");
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const { error } = await db().from("spend_confirmations").insert({ viewer_id: viewer.id, session_id: viewer.sessionId, code });
  if (error) return err(500, "failed");

  const text = encodeURIComponent(`CONFIRM ${code}`);
  const waLink = env.waDisplayNumber ? `https://wa.me/${env.waDisplayNumber}?text=${text}` : null;
  return NextResponse.json({ trusted: false, code, waLink });
}

export async function GET() {
  const viewer = await getSessionViewer();
  if (!viewer) return err(401, "signed_out");
  return NextResponse.json({ trusted: viewer.trusted });
}
