// P1 — opening a personal link from WhatsApp (silent sign-in).
//
//  • Already signed in as the link's owner on this device → straight to the episode (link not used up).
//  • First open within 24 h of being sent, on a device not signed in to anyone else → sign in, go to episode.
//  • Anything else (link already opened, too old, or this device belongs to another account)
//    → /continue: the opener continues in WhatsApp and gets a fresh link for THEIR OWN number.
//    A forwarded link therefore never opens the sender's account, wallet or progress.

import { siteUrl } from "@/lib/site/store";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { trackEvent } from "@/lib/events";
import { ACCOUNT_WORD, canSignIn, isFresh, markLinkOpened, peekLink, redeemLink } from "@/lib/links";
import { allow, clientIp } from "@/lib/security/rate-limit";
import { createSession, getSessionViewer, SESSION_COOKIE, SESSION_MAX_AGE_S } from "@/lib/session";
import { db } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStore(res: NextResponse) {
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const base = await siteUrl();
  const ip = clientIp(req.headers);

  // Slow down anyone guessing tokens.
  if (!(await allow(`link:${ip}`, 30, 60))) return new NextResponse("Too many requests", { status: 429 });

  const link = await peekLink(token);
  if (!link) return noStore(NextResponse.redirect(`${base}/link-expired`, 303));

  const { data: series } = link.seriesId
    ? await db().from("series").select("code").eq("id", link.seriesId).maybeSingle()
    : { data: null as { code: string } | null };
  const episode = link.episodeNumber ?? 1;
  // A link without a series is an account link: it opens "My account".
  const target = series?.code ? `${base}/watch/${series.code}/${episode}` : `${base}/me`;
  // Hand-off for anyone this link can't sign in: open the Watchat chat with "شاهد CODE EP" ready to send.
  // One tap on Send proves their own number; the bot replies with a link to their own account.
  const continueUrl = !series?.code
    ? env.waDisplayNumber
      ? `https://wa.me/${env.waDisplayNumber}?text=${encodeURIComponent(ACCOUNT_WORD)}`
      : `${base}/me`
    : env.waDisplayNumber
      ? `https://wa.me/${env.waDisplayNumber}?text=${encodeURIComponent(`شاهد ${series.code} ${episode}`)}`
      : `${base}/continue?s=${series.code}&e=${episode}`;

  const current = await getSessionViewer();

  // The owner, already signed in here: just open the episode.
  if (current && current.id === link.viewerId) {
    await markLinkOpened(token);
    return noStore(NextResponse.redirect(target, 303));
  }

  // Someone else's device, a reused link, or an old link: get your own link in WhatsApp.
  if (current || !canSignIn(link)) {
    const { data: owner } = await db().from("viewers").select("phone_hmac").eq("id", link.viewerId).maybeSingle();
    await trackEvent({
      viewerHmac: owner?.phone_hmac ?? null,
      name: "link_handoff",
      seriesId: link.seriesId,
      episodeNumber: link.episodeNumber,
      props: { reason: current ? "other_account_on_device" : link.usesLeft <= 0 ? "already_used" : "too_old" },
    });
    return noStore(NextResponse.redirect(continueUrl, 303));
  }

  // First open: use the link up atomically (a simultaneous second open loses the race and is handed off).
  const redeemed = await redeemLink(token);
  if (!redeemed) return noStore(NextResponse.redirect(continueUrl, 303));

  await markLinkOpened(token);
  const fresh = isFresh(link);
  const sessionToken = await createSession(redeemed.viewerId, { userAgent: req.headers.get("user-agent"), ip, trusted: fresh });
  const { data: viewer } = await db()
    .from("viewers")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", redeemed.viewerId)
    .select("phone_hmac")
    .single();

  await trackEvent({
    viewerHmac: viewer?.phone_hmac ?? null,
    name: "link_opened",
    seriesId: redeemed.seriesId,
    episodeNumber: redeemed.episodeNumber,
    props: { fresh },
  });

  const res = NextResponse.redirect(target, 303);
  res.cookies.set(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    secure: base.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
  return noStore(res);
}
