// My List bookmark: POST { code } saves the series, or removes it when it's already saved.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { toggleMyList } from "@/lib/content";
import { allow } from "@/lib/security/rate-limit";
import { err, readJson, sameOrigin } from "@/lib/security/request";
import { getSessionViewer } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return err(403, "forbidden");
  const viewer = await getSessionViewer();
  if (!viewer) return err(401, "signed_out");
  if (!(await allow(`list:${viewer.id}`, 60, 600))) return err(429, "slow_down");
  const body = await readJson<{ code?: string }>(req);
  const code = String(body?.code ?? "").trim();
  if (!/^[A-Za-z]{3,}\d{1,3}$/.test(code)) return err(400, "bad_code");
  const saved = await toggleMyList(viewer.id, code);
  if (saved === null) return err(404, "not_found");
  return NextResponse.json({ saved });
}
