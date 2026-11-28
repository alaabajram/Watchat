// AI People: POST { slug, text } sends one message and returns the character's reply and the new allowance.

import { NextResponse, type NextRequest } from "next/server";
import { personBySlug, sendToPerson } from "@/lib/play/store";
import { err, readJson, sameOrigin } from "@/lib/security/request";
import { getSessionViewer } from "@/lib/session";
import { currentTenantId } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return err(403, "forbidden");
  const viewer = await getSessionViewer();
  if (!viewer) return err(401, "signed_out");
  const body = await readJson<{ slug?: string; text?: string }>(req);
  const slug = String(body?.slug ?? "");
  if (!/^[a-z0-9-]{2,40}$/.test(slug)) return err(400, "bad_request");
  const tenantId = await currentTenantId();
  const person = await personBySlug(tenantId, slug);
  if (!person) return err(404, "not_found");
  const r = await sendToPerson(tenantId, viewer, person, String(body?.text ?? ""));
  if (!r.ok) return err(r.error === "slow_down" ? 429 : r.error === "need_ping" ? 402 : 400, r.error, { cost: r.cost });
  return NextResponse.json(r);
}
