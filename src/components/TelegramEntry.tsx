"use client";

// Telegram landing: reads Telegram's launch data from the address (#tgWebAppData=…; no Telegram script needed;
// kept for the tab so later pages can sign in again), signs in through /api/telegram/auth and moves on.
// Opened outside Telegram, it offers to open the Watchat bot. The animated Watchat logo; only the button is Telegram blue.

import { useEffect, useState } from "react";
import { AnimatedLogo } from "./brand/AnimatedLogo";
import { signInWithTelegram, telegramInitData, TelegramPlane } from "./TelegramSignIn";
import { dirFor, webCopy, type Locale } from "@/lib/web-copy";

const TEXT = {
  ar: { working: "جاري الدخول بحساب تيليجرام…", outside: "افتح واتشات من بوت تيليجرام وبتدخل تلقائيًا بحسابك.", failed: "ما قدرنا ندخّلك. سكّر الصفحة وافتحها من البوت مرة ثانية." },
  en: { working: "Signing you in with Telegram…", outside: "Open Watchat from the Telegram bot and you're signed in automatically.", failed: "Couldn't sign you in. Close this and open it again from the bot." },
};

export function TelegramEntry({ to, botHref, locale }: { to: string | null; botHref: string | null; locale: Locale }) {
  const [state, setState] = useState<"working" | "outside" | "failed">("working");
  const t = webCopy(locale);
  const x = TEXT[locale];

  useEffect(() => {
    const initData = telegramInitData();
    if (!initData) {
      setState("outside");
      return;
    }
    signInWithTelegram(initData, to)
      .then((next) => (next ? window.location.replace(next) : setState("failed")))
      .catch(() => setState("failed"));
  }, [to]);

  return (
    <div className="wc" dir={dirFor(locale)} lang={locale}>
      <main style={{ minHeight: "100dvh", boxSizing: "border-box", display: "flex", flexDirection: "column", padding: "24px 24px calc(32px + env(safe-area-inset-bottom))", maxWidth: 520, margin: "0 auto" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 28, textAlign: "center" }}>
          <AnimatedLogo />
          <p role="status" style={{ fontSize: 17, color: "var(--wc-muted)", margin: 0 }}>
            {state === "working" ? x.working : state === "outside" ? x.outside : x.failed}
          </p>
          {state === "working" && <span className="wc-tg-spinner" aria-hidden="true" />}
        </div>
        {state !== "working" && botHref && (
          <a className="wc-btn wc-btn-tg" href={botHref} style={{ minHeight: 60 }}>
            <TelegramPlane />
            {t.telegramFreshLink}
          </a>
        )}
      </main>
    </div>
  );
}
