// Tap webhook ("post" URL). The body is treated only as a hint: the charge is re-read from Tap's API
// with our secret key and checked against our order before anything is granted. Idempotent.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { verifyAndFulfil } from "@/lib/wallet";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let chargeId: string | undefined;
  try {
    const body = (await req.json()) as { id?: string };
    chargeId = body.id;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (!chargeId) return NextResponse.json({ ok: false }, { status: 400 });
  try {
    const { outcome } = await verifyAndFulfil(chargeId);
    return NextResponse.json({ ok: true, outcome });
  } catch (e) {
    console.error("[tap-webhook] failed", e);
    // 500 makes Tap retry later.
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
