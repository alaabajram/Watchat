// watchat.pro for visitors without a session: the animated logo and one way in — WhatsApp.
// The bot answers the pre-filled «ابدأ» with the menu; the personal link it sends signs this browser in,
// and from then on "/" opens the home screen instead.

/* eslint-disable @next/next/no-img-element */
import { ChatIcon } from "./icons";
import { webCopy, dirFor, type Locale } from "@/lib/web-copy";

export function Splash({ locale, waHref, cta, hint, path = "/" }: { locale: Locale; waHref: string | null; cta?: string; hint?: string; path?: string }) {
  const t = webCopy(locale);
  const sep = path.includes("?") ? "&" : "?";
  const other = locale === "ar" ? { href: `${path}${sep}lang=en`, label: "EN", aria: "English" } : { href: path, label: "عربي", aria: "العربية" };
  return (
    <div className="wc" dir={dirFor(locale)} lang={locale} style={{ background: "#fff" }}>
    <main style={{ minHeight: "100dvh", boxSizing: "border-box", display: "flex", flexDirection: "column", padding: "20px 24px calc(32px + env(safe-area-inset-bottom))", maxWidth: 520, margin: "0 auto" }}>
      <div>
        <a href={other.href} aria-label={other.aria} lang={locale === "ar" ? "en" : "ar"} className="wc-pill" style={{ background: "var(--wc-bg)", fontSize: 14 }}>
          {other.label}
        </a>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 28, minHeight: 420 }}>
        <h1 style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 30, fontSize: "inherit" }}>
          <span className="wc-logo" aria-hidden="true">
            <span className="wc-logo-clip">
              <span className="wc-logo-strip">
                {[0, 1, 2, 3].map((i) => (
                  <img key={i} src="/brand/emblem-bubble.png" alt="" />
                ))}
              </span>
            </span>
            <span className="wc-logo-dot">
              <span className="wc-ring" />
              <img src="/brand/emblem-dot.png" alt="" />
            </span>
          </span>
          <img src="/brand/lockup-text.png" alt="Watchat · واتشات" width={200} height={100} style={{ width: 200, height: "auto", display: "block" }} />
        </h1>
        <p className="wc-fade-in" style={{ fontSize: 18, color: "#4e4943", textAlign: "center" }}>
          {t.tagline}
        </p>
      </div>

      <div className="wc-fade-in" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {waHref && (
          <a className="wc-btn" href={waHref} style={{ minHeight: 60 }}>
            <ChatIcon />
            {cta ?? t.startInWhatsApp}
          </a>
        )}
        <p style={{ fontSize: 13, color: "var(--wc-muted)", textAlign: "center" }}>{hint ?? t.splashHint}</p>
      </div>
    </main>
    </div>
  );
}
