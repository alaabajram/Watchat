// "Connect Telegram": a one-time link to the Watchat bot; opening it in Telegram adds that Telegram to this account.

import { NextResponse, type NextRequest } from "next/server";
import { allow } from "@/lib/security/rate-limit";
import { err, sameOrigin } from "@/lib/security/request";
import { getSessionViewer } from "@/lib/session";
import { telegramLinkFor } from "@/lib/signin/accounts";
import { currentTenantId } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return err(403, "forbidden");
  const viewer = await getSessionViewer();
  if (!viewer) return err(401, "signed_out");
  if (!(await allow(`link-tg:${viewer.id}`, 10, 900))) return err(429, "slow_down");
  const href = await telegramLinkFor(await currentTenantId(), viewer.id);
  if (!href) return err(404, "not_configured");
  return NextResponse.json({ ok: true, href }, { headers: { "Cache-Control": "no-store" } });
}
