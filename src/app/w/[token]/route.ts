// P1 — opening a personal link from WhatsApp (silent sign-in).
// Swaps the link token for a session cookie, then sends the viewer straight to their episode.

import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { trackEvent } from "@/lib/events";
import { redeemLink } from "@/lib/links";
import { allow, clientIp } from "@/lib/security/rate-limit";
import { createSession, SESSION_COOKIE, SESSION_MAX_AGE_S } from "@/lib/session";
import { db } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const base = env.appUrl;
  const ip = clientIp(req.headers);

  // Slow down anyone guessing tokens.
  if (!(await allow(`link:${ip}`, 30, 60))) return new NextResponse("Too many requests", { status: 429 });

  const link = await redeemLink(token);
  if (!link) return NextResponse.redirect(`${base}/link-expired`, 303);

  const [{ data: viewer }, { data: series }] = await Promise.all([
    db().from("viewers").select("phone_hmac").eq("id", link.viewerId).single(),
    link.seriesId
      ? db().from("series").select("code").eq("id", link.seriesId).single()
      : Promise.resolve({ data: null as { code: string } | null }),
  ]);

  const sessionToken = await createSession(link.viewerId, {
    userAgent: req.headers.get("user-agent"),
    ip,
    trusted: link.fresh,
  });
  await db().from("viewers").update({ last_seen_at: new Date().toISOString() }).eq("id", link.viewerId);

  await trackEvent({
    viewerHmac: viewer?.phone_hmac ?? null,
    name: "link_opened",
    seriesId: link.seriesId,
    episodeNumber: link.episodeNumber,
    props: { fresh: link.fresh },
  });

  const target = series?.code ? `${base}/watch/${series.code}/${link.episodeNumber ?? 1}` : `${base}/`;
  const res = NextResponse.redirect(target, 303);
  res.cookies.set(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    secure: base.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}
