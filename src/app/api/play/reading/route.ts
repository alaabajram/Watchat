// Fortune Teller: POST { question } buys one three-card reading (Ping price from Admin → Daily).

import { NextResponse, type NextRequest } from "next/server";
import { buyReading } from "@/lib/play/store";
import { err, readJson, sameOrigin } from "@/lib/security/request";
import { getSessionViewer } from "@/lib/session";
import { currentTenantId } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return err(403, "forbidden");
  const viewer = await getSessionViewer();
  if (!viewer) return err(401, "signed_out");
  const body = await readJson<{ question?: string }>(req);
  const r = await buyReading(await currentTenantId(), viewer, String(body?.question ?? ""));
  if (!r.ok) return err(r.error === "slow_down" ? 429 : 402, r.error, { cost: r.cost });
  return NextResponse.json(r);
}
