// Partner (affiliate) link (/r/CODE): counts the click and opens WhatsApp with the partner code prefilled.
// New viewers who start from it are attributed to the partner, who earns commission on their payments.

import { NextResponse, type NextRequest } from "next/server";
import { sha256Hex } from "@/lib/crypto";
import { env } from "@/lib/env";
import { allow } from "@/lib/security/rate-limit";
import { siteUrl } from "@/lib/site/store";
import { currentTenantId, db } from "@/lib/supabase";

export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const clean = code.toUpperCase();
  if (!/^[A-Z0-9]{3,20}$/.test(clean) || !env.waDisplayNumber) return NextResponse.redirect(await siteUrl());
  const { data: aff } = await db().from("affiliates").select("id, clicks").eq("tenant_id", await currentTenantId()).eq("code", clean).eq("active", true).maybeSingle();
  if (!aff) return NextResponse.redirect(await siteUrl());
  // One counted click per IP per hour per partner.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "?";
  if (await allow(`aff:${aff.id}:${sha256Hex(ip).slice(0, 16)}`, 1, 3600)) await db().rpc("bump_affiliate_click", { p_affiliate: aff.id });
  const text = `أهلاً واتشات 👋 P-${clean}`;
  return NextResponse.redirect(`https://wa.me/${env.waDisplayNumber}?text=${encodeURIComponent(text)}`);
}
