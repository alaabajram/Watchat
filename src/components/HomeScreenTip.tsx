"use client";

// Once after signing in on an iPhone (outside Telegram and not already opened from the Home Screen): how to add
// Watchat to the Home Screen, so it opens signed in like an app. Every app on an iPhone keeps its own sign-in,
// and the Home Screen icon keeps one that lasts.

import { useEffect, useState } from "react";
import { A2HS_KEY } from "./SignInDoors";

const T = {
  ar: {
    title: "خلّ واتشات على شاشتك الرئيسية",
    body: "في Safari اضغط زر المشاركة ⬆️ ثم «إضافة إلى الشاشة الرئيسية». يفتح واتشات بعدها مثل التطبيق وأنت داخل بحسابك.",
    inApp: "فتحت الصفحة داخل تطبيق آخر؟ افتح watchat.pro في Safari أولًا.",
    ok: "تمام",
  },
  en: {
    title: "Keep Watchat on your Home Screen",
    body: "In Safari, tap Share ⬆️ then “Add to Home Screen”. Watchat then opens like an app, already signed in.",
    inApp: "Opened inside another app? Open watchat.pro in Safari first.",
    ok: "Got it",
  },
};

export function HomeScreenTip({ locale, flush }: { locale: "ar" | "en"; /** inside a padded column */ flush?: boolean }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(A2HS_KEY) !== "1") return;
      const ua = navigator.userAgent;
      const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
      const telegram = Boolean((window as unknown as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp?.initData) || /Telegram/i.test(ua) || location.hash.includes("tgWebAppData");
      if (ios && !standalone && !telegram) setShow(true);
      else window.localStorage.removeItem(A2HS_KEY);
    } catch {
      /* storage blocked: no tip */
    }
  }, []);
  if (!show) return null;
  const t = T[locale];
  const close = () => {
    try {
      window.localStorage.removeItem(A2HS_KEY);
    } catch {
      /* ignore */
    }
    setShow(false);
  };
  return (
    <aside className="wc-card wc-a2hs" role="note" aria-label={t.title} style={flush ? { margin: 0 } : undefined}>
      <strong>📲 {t.title}</strong>
      <p>{t.body}</p>
      <p className="wc-a2hs-small">{t.inApp}</p>
      <button type="button" className="wc-btn wc-btn-sm" onClick={close} style={{ alignSelf: "flex-start" }}>
        {t.ok}
      </button>
    </aside>
  );
}
