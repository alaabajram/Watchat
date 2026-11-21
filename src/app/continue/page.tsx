// "Sign in with WhatsApp" — shown when a Watchat link is opened on a browser we can't tie to its owner
// (a forwarded link on another phone, a re-opened or expired link). Sending the pre-filled message
// proves the opener's own number; the bot replies with a link to THEIR account (new viewers get a new one).
// The owner's account is never opened here.

import { Splash } from "@/components/brand/Splash";
import { env } from "@/lib/env";
import { webCopy } from "@/lib/web-copy";
import { botLink, visitorChannel } from "@/lib/telegram/channel";

export const dynamic = "force-dynamic";

export default async function ContinuePage({ searchParams }: { searchParams: Promise<{ s?: string; e?: string; lang?: string }> }) {
  const sp = await searchParams;
  const locale = sp.lang === "en" ? "en" : "ar";
  const t = webCopy(locale);
  const code = /^[A-Za-z0-9_-]{2,40}$/.test(sp.s ?? "") ? sp.s! : null;
  const ep = /^\d{1,3}$/.test(sp.e ?? "") ? sp.e! : null;
  const message = code ? `شاهد ${code}${ep ? ` ${ep}` : ""}` : "LINK";
  const wa = env.waDisplayNumber ? `https://wa.me/${env.waDisplayNumber}?text=${encodeURIComponent(message)}` : null;
  const path = code ? `/continue?s=${encodeURIComponent(code)}${ep ? `&e=${ep}` : ""}` : "/continue";
  // From Telegram: sign in with Telegram and land straight on the episode (or open the bot at that series).
  const tg = (await visitorChannel()) === "telegram" ? { href: await botLink(code), to: code ? `/watch/${code}/${ep ?? 1}` : "/" } : null;
  return <Splash locale={locale} waHref={wa} cta={t.signInWithWhatsApp} hint={wa ? t.continueBody : t.continueManual(message)} path={path} telegram={tg} />;
}
