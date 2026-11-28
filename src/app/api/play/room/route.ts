// Rooms: POST { slug, option } answers today's round once; the answer returns the results.

import { NextResponse, type NextRequest } from "next/server";
import { answerRoom } from "@/lib/play/store";
import { err, readJson, sameOrigin } from "@/lib/security/request";
import { getSessionViewer } from "@/lib/session";
import { currentTenantId } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return err(403, "forbidden");
  const viewer = await getSessionViewer();
  if (!viewer) return err(401, "signed_out");
  const body = await readJson<{ slug?: string; option?: string }>(req);
  const slug = String(body?.slug ?? "");
  const option = String(body?.option ?? "");
  if (!/^[a-z0-9-]{2,40}$/.test(slug) || !/^[a-z0-9]{1,4}$/.test(option)) return err(400, "bad_request");
  const r = await answerRoom(await currentTenantId(), viewer, slug, option);
  if (!r.ok) return err(r.error === "slow_down" ? 429 : r.error === "not_found" ? 404 : 400, r.error);
  return NextResponse.json({ view: r.view, rewarded: r.rewarded });
}
