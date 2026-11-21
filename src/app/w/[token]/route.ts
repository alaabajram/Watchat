// P1 — opening a personal link from the Watchat chat. Rules: decideLinkOpen in lib/links.
//
//  • Signed in here as the owner → the episode.
//  • Signed in here to another account (a forwarded link) → stays in that account, same episode on the web.
//  • The owner's own browser whose session went idle → signed in again silently → the episode.
//  • A brand-new browser, first open within minutes of sending (a new viewer's first link) → signed in.
//  • Anything else (unknown browser: forwarded, re-opened or expired link) → "Sign in with WhatsApp" page.
//    An unknown browser never gets the owner's account.

import { canonicalRedirect } from "@/lib/canonical";
import { siteUrl } from "@/lib/site/store";
import { NextResponse, type NextRequest } from "next/server";
import { trackEvent } from "@/lib/events";
import { decideLinkOpen, markLinkOpened, peekLink, redeemLink } from "@/lib/links";
import { allow, clientIp } from "@/lib/security/rate-limit";
import { browserViewerId, createSession, getSessionViewer, SESSION_COOKIE, SESSION_COOKIE_MAX_AGE_S } from "@/lib/session";
import { db } from "@/lib/supabase";
import { isTelegram } from "@/lib/telegram/telegram";

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

  // Sign in on the site's own address only. A link built with another hostname (an older link, or one minted
  // before the site address was set — e.g. the vercel.app domain) would save the sign-in on that hostname,
  // where watchat.pro/me can't see it. So hop to the canonical address first, then sign in there.
  const canonical = canonicalRedirect(req.nextUrl, base);
  if (canonical) return noStore(NextResponse.redirect(canonical, 307));
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
  // Anyone this link can't sign in: the "Sign in with WhatsApp" page. The pre-filled message is sent from
  // their own number, and the bot replies with a link to THEIR account (a new one for a new viewer).
  const askUrl = series?.code ? `${base}/continue?s=${encodeURIComponent(series.code)}&e=${episode}` : `${base}/me`;

  const current = await getSessionViewer();
  const browser = current ? current.id : await browserViewerId();
  let decision = decideLinkOpen(link, current?.id ?? null, browser);

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

  // A brand-new browser may sign in only on the link's first open — recorded atomically, so two
  // simultaneous opens (e.g. owner and a friend) can't both get in.
  // Only record the first open when this browser is actually being signed in.
  const signingIn = decision === "sign_in_first_open" || decision === "sign_in_owner";
  const firstOpen = signingIn && link.usesLeft > 0 ? Boolean(await redeemLink(token)) : false;
  if (decision === "sign_in_first_open" && !firstOpen) decision = "ask_whatsapp";

  if (decision === "ask_whatsapp") {
    const { data: owner } = await db().from("viewers").select("phone_hmac, phone_e164").eq("id", link.viewerId).maybeSingle();
    await trackEvent({
      viewerHmac: owner?.phone_hmac ?? null,
      name: "link_handoff",
      seriesId: link.seriesId,
      episodeNumber: link.episodeNumber,
      props: { reason: browser ? "other_account_browser" : link.expired ? "expired" : link.usesLeft <= 0 ? "unknown_browser_reopen" : "unknown_browser_late" },
    });
    // A Telegram viewer's link: sign in with Telegram (the Mini App's launch data survives the redirect), never WhatsApp.
    if (isTelegram(owner?.phone_e164)) {
      const path = target.slice(base.replace(/\/$/, "").length) || "/";
      return noStore(NextResponse.redirect(`${base.replace(/\/$/, "")}/tg?to=${encodeURIComponent(path)}`, 303));
    }
    return noStore(NextResponse.redirect(askUrl, 303));
  }

  // sign_in_owner (the owner's own browser) or sign_in_first_open (first open, just sent).
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
    props: { how: decision },
  });

  const res = NextResponse.redirect(target, 303);
  res.cookies.set(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    secure: base.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE_S,
  });
  return noStore(res);
}
