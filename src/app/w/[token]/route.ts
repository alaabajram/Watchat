// P1 — opening a personal link from the Watchat chat (silent sign-in). Rules: decideLinkOpen in lib/links.
//
//  • Signed in here as the link's owner → straight to the episode.
//  • Signed in here to another account (a forwarded link) → that viewer stays in their own account and
//    lands on the same episode on the web.
//  • Not signed in → sign the owner in silently (every time, until the link expires) → episode.
//  • Expired → continue in WhatsApp; the bot sends a fresh link.

import { siteUrl } from "@/lib/site/store";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { trackEvent } from "@/lib/events";
import { ACCOUNT_WORD, decideLinkOpen, markLinkOpened, peekLink, redeemLink } from "@/lib/links";
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
  const decision = decideLinkOpen(link, current?.id ?? null);

  // The owner, already signed in here: just open the episode.
  if (decision === "open") {
    await markLinkOpened(token);
    return noStore(NextResponse.redirect(target, 303));
  }

  // Someone else's link opened on a browser signed in to their own account: keep them in it.
  if (decision === "open_as_current" && current) {
    await trackEvent({ viewerHmac: current.phoneHmac, name: "link_shared_open", seriesId: link.seriesId, episodeNumber: link.episodeNumber });
    return noStore(NextResponse.redirect(target, 303));
  }

  // Expired: get a fresh link in WhatsApp.
  if (decision === "expired") {
    const { data: owner } = await db().from("viewers").select("phone_hmac").eq("id", link.viewerId).maybeSingle();
    await trackEvent({
      viewerHmac: owner?.phone_hmac ?? null,
      name: "link_handoff",
      seriesId: link.seriesId,
      episodeNumber: link.episodeNumber,
      props: { reason: "too_old" },
    });
    return noStore(NextResponse.redirect(continueUrl, 303));
  }

  // Not signed in: sign the owner in (every open; the first open is recorded for stats).
  const firstOpen = link.usesLeft > 0 ? Boolean(await redeemLink(token)) : false;
  await markLinkOpened(token);
  const sessionToken = await createSession(link.viewerId, { userAgent: req.headers.get("user-agent"), ip });
  const { data: viewer } = await db()
    .from("viewers")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", link.viewerId)
    .select("phone_hmac")
    .single();

  await trackEvent({
    viewerHmac: viewer?.phone_hmac ?? null,
    name: "link_opened",
    seriesId: link.seriesId,
    episodeNumber: link.episodeNumber,
    props: { reopen: !firstOpen },
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
