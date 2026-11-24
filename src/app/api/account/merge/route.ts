// "Merge these two accounts?" → yes: the other account moves into the signed-in one (Ping, passes, unlocked
// episodes, progress, story choices, My List, devices). Only the viewer who got the merge request can confirm it.

import { NextResponse, type NextRequest } from "next/server";
import { err, readJson, sameOrigin } from "@/lib/security/request";
import { getSessionViewer } from "@/lib/session";
import { confirmMerge } from "@/lib/signin/accounts";
import { currentTenantId } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return err(403, "forbidden");
  const viewer = await getSessionViewer();
  if (!viewer) return err(401, "signed_out");
  const body = await readJson<{ token?: string }>(req);
  const token = String(body?.token ?? "");
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) return err(400, "expired");
  const r = await confirmMerge(await currentTenantId(), viewer.id, token);
  if (!r.ok) return err(400, r.error);
  return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
}
