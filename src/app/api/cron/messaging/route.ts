// Runs every 15 minutes (vercel.json → crons). Vercel sends "Authorization: Bearer <CRON_SECRET>".

import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { runMessaging } from "@/lib/messaging/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const summary = await runMessaging();
  console.log("[cron] messaging", JSON.stringify(summary));
  return NextResponse.json(summary);
}
