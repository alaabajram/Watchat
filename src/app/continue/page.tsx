// Sign in — shown when a Watchat link is opened on a browser we can't tie to its owner (a forwarded link on
// another phone, a re-opened or expired link). Every door proves the opener's own identity (their WhatsApp,
// Telegram, phone number or email) and lands on the episode in THEIR account (new viewers get a new one).
// The owner's account is never opened here.

import { Splash } from "@/components/brand/Splash";
import { webCopy } from "@/lib/web-copy";
import { doorSetup } from "@/lib/signin/server";

export const dynamic = "force-dynamic";

export default async function ContinuePage({ searchParams }: { searchParams: Promise<{ s?: string; e?: string; lang?: string }> }) {
  const sp = await searchParams;
  const locale = sp.lang === "en" ? "en" : "ar";
  const t = webCopy(locale);
  const code = /^[A-Za-z0-9_-]{2,40}$/.test(sp.s ?? "") ? sp.s! : null;
  const ep = /^\d{1,3}$/.test(sp.e ?? "") ? sp.e! : null;
  const message = code ? `شاهد ${code}${ep ? ` ${ep}` : ""}` : "LINK";
  const path = code ? `/continue?s=${encodeURIComponent(code)}${ep ? `&e=${ep}` : ""}` : "/continue";
  // Every door lands straight on the episode (Telegram opens the bot at that series).
  const setup = await doorSetup({ waText: message, to: code ? `/watch/${code}/${ep ?? 1}` : "/", tgStart: code });
  return <Splash locale={locale} setup={setup} cta={t.signInWithWhatsApp} hint={t.continueBody} path={path} />;
}
