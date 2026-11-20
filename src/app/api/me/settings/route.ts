// Viewer settings: interface language and subtitles (Arabic / English subtitles).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { err, readJson, sameOrigin } from "@/lib/security/request";
import { getSessionViewer } from "@/lib/session";
import { db } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return err(403, "forbidden");
  const viewer = await getSessionViewer();
  if (!viewer) return err(401, "signed_out");
  const body = await readJson<{ locale?: string }>(req);
  if (body?.locale !== "ar" && body?.locale !== "en") return err(400, "bad_request");
  await db()
    .from("viewers")
    .update({ ui_locale: body.locale, language: body.locale === "en" ? "ar_en_subs" : "ar" })
    .eq("id", viewer.id);
  return NextResponse.json({ ok: true });
}
