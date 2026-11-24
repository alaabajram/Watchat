// watchat.pro for visitors without a session: the animated logo and every way in on one screen
// (`SignInDoors`): WhatsApp and Telegram (the visitor's own app first), then phone number and email. Whichever
// door they use, they end up in the same account, signed in on this browser.

/* eslint-disable @next/next/no-img-element */
import { AnimatedLogo } from "./AnimatedLogo";
import { SignInDoors } from "../SignInDoors";
import type { DoorSetup } from "@/lib/signin/server";
import { webCopy, dirFor, type Locale } from "@/lib/web-copy";

export function Splash({
  locale,
  setup,
  cta,
  hint,
  path = "/",
}: {
  locale: Locale;
  setup: DoorSetup;
  /** WhatsApp button text ("Sign in with WhatsApp" on account pages). */
  cta?: string;
  /** Shown under the doors when WhatsApp is one of them (how the WhatsApp way works). */
  hint?: string;
  path?: string;
}) {
  const t = webCopy(locale);
  const sep = path.includes("?") ? "&" : "?";
  const other = locale === "ar" ? { href: `${path}${sep}lang=en`, label: "EN", aria: "English" } : { href: path, label: "عربي", aria: "العربية" };
  return (
    <div className="wc" dir={dirFor(locale)} lang={locale} data-no-chat="">
    <main style={{ minHeight: "100dvh", boxSizing: "border-box", display: "flex", flexDirection: "column", padding: "20px 24px calc(32px + env(safe-area-inset-bottom))", maxWidth: 520, margin: "0 auto" }}>
      <div>
        <a href={other.href} aria-label={other.aria} lang={locale === "ar" ? "en" : "ar"} className="wc-pill" style={{ background: "var(--wc-bg)", fontSize: 14 }}>
          {other.label}
        </a>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 28, minHeight: 420 }}>
        <AnimatedLogo />
        <p className="wc-fade-in" style={{ fontSize: 18, color: "var(--wc-muted)", textAlign: "center" }}>
          {t.tagline}
        </p>
      </div>

      <div className="wc-fade-in" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <SignInDoors
          locale={locale}
          doors={setup.doors}
          waHref={setup.waHref}
          tgHref={setup.tgHref}
          to={setup.to}
          waLabel={cta}
          tgLabel={cta ? t.signInWithTelegram : undefined}
        />
        {setup.doors.length === 0 ? (
          <p className="wc-signin-note" style={{ textAlign: "center" }}>
            {t.noDoors}
          </p>
        ) : (
          setup.doors[0] === "whatsapp" &&
          (hint ?? t.splashHint) && (
            <p style={{ fontSize: 14, lineHeight: 1.8, color: "var(--wc-muted)", textAlign: "start", whiteSpace: "pre-line", background: "var(--wc-card)", borderRadius: 16, padding: "10px 14px", margin: 0 }}>
              {hint ?? t.splashHint}
            </p>
          )
        )}
      </div>
    </main>
    </div>
  );
}
