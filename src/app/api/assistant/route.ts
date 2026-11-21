// POST /api/assistant { message } or { chip }: the viewer assistant. Signed-in viewers only.

import { NextResponse } from "next/server";
import { ask } from "@/lib/assistant/run";
import { getSessionViewer } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const viewer = await getSessionViewer();
  if (!viewer) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { message?: unknown; chip?: unknown };
  const message = typeof body.message === "string" ? body.message : undefined;
  const chip = typeof body.chip === "string" ? body.chip : undefined;
  if (!message && !chip) return NextResponse.json({ error: "empty" }, { status: 400 });
  const answer = await ask({ id: viewer.id, country: viewer.country, uiLocale: viewer.uiLocale }, { message, chip });
  return NextResponse.json(answer, { headers: { "Cache-Control": "no-store" } });
}
