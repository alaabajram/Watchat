// Invite link (/i/XXXXXX): opens WhatsApp with the invite code prefilled. The bot reads it on the friend's
// first message (economy/rewards.ts → onNewViewer) and both get their Ping.

import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { siteUrl } from "@/lib/site/store";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const clean = code.toUpperCase();
  if (!/^[2-9A-HJ-NP-Z]{6}$/.test(clean) || !env.waDisplayNumber) return NextResponse.redirect(await siteUrl());
  const text = `أهلاً واتشات 👋 INV-${clean}`;
  return NextResponse.redirect(`https://wa.me/${env.waDisplayNumber}?text=${encodeURIComponent(text)}`);
}
