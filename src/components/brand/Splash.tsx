// watchat.pro for visitors without a session: the animated logo and one way in — WhatsApp, or Telegram (in
// Telegram blue) for visitors who come from the Telegram bot.
// The bot answers the pre-filled «ابدأ» with the menu; the personal link it sends signs this browser in,
// and from then on "/" opens the home screen instead.

/* eslint-disable @next/next/no-img-element */
import { AnimatedLogo } from "./AnimatedLogo";
import { ChatIcon } from "./icons";
import { TelegramSignIn } from "../TelegramSignIn";
import { webCopy, dirFor, type Locale } from "@/lib/web-copy";

export function Splash({
  locale,
  waHref,
  cta,
  hint,
  path = "/",
  telegram,
}: {
  locale: Locale;
  waHref: string | null;
  cta?: string;
  hint?: string;
  path?: string;
  /** Set for Telegram visitors: sign in with Telegram instead of WhatsApp (href opens the bot outside Telegram). */
  telegram?: { href: string | null; to?: string } | null;
}) {
  const t = webCopy(locale);
  const sep = path.includes("?") ? "&" : "?";
  const other = locale === "ar" ? { href: `${path}${sep}lang=en`, label: "EN", aria: "English" } : { href: path, label: "عربي", aria: "العربية" };
  return (
    <div className="wc" dir={dirFor(locale)} lang={locale} style={{ background: "#fff" }} data-no-chat="">
    <main style={{ minHeight: "100dvh", boxSizing: "border-box", display: "flex", flexDirection: "column", padding: "20px 24px calc(32px + env(safe-area-inset-bottom))", maxWidth: 520, margin: "0 auto" }}>
      <div>
        <a href={other.href} aria-label={other.aria} lang={locale === "ar" ? "en" : "ar"} className="wc-pill" style={{ background: "var(--wc-bg)", fontSize: 14 }}>
          {other.label}
        </a>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 28, minHeight: 420 }}>
        <AnimatedLogo />
        <p className="wc-fade-in" style={{ fontSize: 18, color: "#4e4943", textAlign: "center" }}>
          {t.tagline}
        </p>
      </div>

      <div className="wc-fade-in" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {telegram ? (
          <TelegramSignIn href={telegram.href} label={cta ? t.signInWithTelegram : t.startInTelegram} to={telegram.to ?? (path.split("?")[0] || "/")} />
        ) : (
          waHref && (
            <a className="wc-btn" href={waHref} style={{ minHeight: 60 }}>
              <ChatIcon />
              {cta ?? t.startInWhatsApp}
            </a>
          )
        )}
        <p style={{ fontSize: 15, lineHeight: 1.9, color: "#4e4943", textAlign: "start", whiteSpace: "pre-line", background: telegram ? "#e8f3fb" : "var(--wc-bg)", borderRadius: 16, padding: "12px 16px" }}>
          {telegram ? t.telegramHint : (hint ?? t.splashHint)}
        </p>
      </div>
    </main>
    </div>
  );
}
