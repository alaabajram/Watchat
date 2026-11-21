// Runs every 15 minutes (vercel.json → crons). Vercel sends "Authorization: Bearer <CRON_SECRET>".

import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { runBilling } from "@/lib/economy/billing";
import { runFlowWaits } from "@/lib/flows/runner";
import { maybeRunGrowth } from "@/lib/growth/run";
import { syncTemplateStatuses } from "@/lib/messaging/template-store";
import { currentTenantId } from "@/lib/supabase";
import { wabaConfigured } from "@/lib/whatsapp/templates";
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
  // Keep template approval status fresh so flows and the builder see approvals without a manual sync.
  let templates: number | string = "skipped";
  if (wabaConfigured()) {
    try {
      templates = await syncTemplateStatuses(await currentTenantId());
    } catch (e) {
      templates = e instanceof Error ? e.message : "sync failed";
    }
  }
  const flows = await runFlowWaits();
  // Growth agent: once a day at the chosen hour (Suggest mode queues suggestions for the team).
  let growth: unknown = "not_due";
  try {
    growth = await maybeRunGrowth(await currentTenantId());
  } catch (e) {
    growth = e instanceof Error ? e.message : "growth run failed";
  }
  // Weekly / yearly passes: expire ended ones and renew due ones with the saved card.
  let billing: unknown = "skipped";
  try {
    billing = await runBilling();
  } catch (e) {
    billing = e instanceof Error ? e.message : "billing failed";
  }
  const summary = await runMessaging();
  console.log("[cron] messaging", JSON.stringify({ templates, flows, growth, billing, ...summary }));
  return NextResponse.json({ templates, flows, growth, ...summary });
}
