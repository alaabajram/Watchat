"use client";

// Turn on morning alerts here (web push) and keep Watchat on the home screen: the free alternative to
// WhatsApp messages. iPhone only allows web alerts from an app added to the home screen, so there we show how
// to add it first; Android and computers can turn alerts on straight away (and Android can install the app).

import { useEffect, useState } from "react";

type Locale = "ar" | "en";
type State = "loading" | "unsupported" | "ios_install" | "ask" | "on" | "blocked" | "busy" | "error";

const T = {
  ar: {
    title: "تنبيه الصباح",
    body: "خلّ واتشات على شاشتك الرئيسية، ونذكّرك كل صباح ببطاقتك وبرجك وجولات الغرف الجديدة.",
    turnOn: "فعّل التنبيهات",
    on: "التنبيهات شغّالة هنا ✓",
    off: "إيقاف",
    blocked: "التنبيهات موقوفة لهذا الموقع. فعّلها من إعدادات المتصفح.",
    install: "أضف واتشات للشاشة الرئيسية",
    iosTitle: "أضف واتشات للشاشة الرئيسية",
    iosSteps: ["اضغط زر المشاركة ⬆︎ تحت في سفاري", "اختر «إضافة إلى الشاشة الرئيسية»", "افتح واتشات من الشاشة الرئيسية وفعّل التنبيهات"],
    unsupported: "احفظ هذه الصفحة في المفضلة لترجع لها بسرعة.",
    error: "ما قدرنا نفعّل التنبيهات. جرّب مرة ثانية.",
    hide: "لاحقًا",
  },
  en: {
    title: "Morning alerts",
    body: "Keep Watchat on your home screen and we'll remind you each morning: your card, your horoscope and new room rounds.",
    turnOn: "Turn on alerts",
    on: "Alerts are on here ✓",
    off: "Turn off",
    blocked: "Alerts are blocked for this site. Allow them in your browser settings.",
    install: "Add Watchat to your home screen",
    iosTitle: "Add Watchat to your home screen",
    iosSteps: ["Tap the Share button ⬆︎ in Safari", "Choose “Add to Home Screen”", "Open Watchat from your home screen and turn on alerts"],
    unsupported: "Bookmark this page to get back quickly.",
    error: "We couldn't turn on alerts. Try again.",
    hide: "Later",
  },
} as const;

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

function platform(): "ios" | "android" | "desktop" {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return "ios";
  return /Android/.test(ua) ? "android" : "desktop";
}
const standalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function keyBytes(base64: string): Uint8Array {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function AlertsOptIn({ locale, compact = false }: { locale: Locale; compact?: boolean }) {
  const t = T[locale];
  const [state, setState] = useState<State>("loading");
  const [install, setInstall] = useState<InstallPrompt | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem("wc-alerts-hidden") === "1") setHidden(true);
    } catch {
      /* storage unavailable */
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    (async () => {
      if (platform() === "ios" && !standalone()) return setState("ios_install");
      if (!pushSupported()) return setState("unsupported");
      if (Notification.permission === "denied") return setState("blocked");
      try {
        const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        const sub = await reg.pushManager.getSubscription();
        if (!sub) return setState("ask");
        const r = await fetch(`/api/push?endpoint=${encodeURIComponent(sub.endpoint)}`);
        const j = (await r.json()) as { subscribed?: boolean };
        setState(j.subscribed ? "on" : "ask");
      } catch {
        setState("ask");
      }
    })();
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  async function turnOn() {
    setState("busy");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setState(permission === "denied" ? "blocked" : "ask");
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const { publicKey } = (await (await fetch("/api/push")).json()) as { publicKey: string };
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) as BufferSource }));
      const r = await fetch("/api/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON(), platform: platform(), installed: standalone() }),
      });
      setState(r.ok ? "on" : "error");
    } catch {
      setState("error");
    }
  }

  async function turnOff() {
    setState("busy");
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        await sub.unsubscribe();
      }
      setState("ask");
    } catch {
      setState("error");
    }
  }

  if (state === "loading" || (hidden && state !== "on")) return null;
  if (state === "on" && compact) return null;

  return (
    <section aria-label={t.title} className="wc-card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span aria-hidden="true" style={{ width: 40, height: 40, borderRadius: 14, background: "rgba(49,229,160,0.18)", display: "grid", placeItems: "center", fontSize: 20, flex: "none" }}>
          🔔
        </span>
        <strong style={{ flex: 1, fontSize: 16 }}>{state === "ios_install" ? t.iosTitle : t.title}</strong>
        {state !== "on" && (
          <button
            type="button"
            onClick={() => {
              setHidden(true);
              try {
                sessionStorage.setItem("wc-alerts-hidden", "1");
              } catch {
                /* storage unavailable */
              }
            }}
            style={{ background: "none", border: 0, color: "var(--wc-muted, #6b6474)", fontSize: 14, padding: 4, cursor: "pointer" }}
          >
            {t.hide}
          </button>
        )}
      </div>

      {state === "ios_install" ? (
        <ol style={{ margin: 0, paddingInlineStart: 20, display: "flex", flexDirection: "column", gap: 6, fontSize: 15 }}>
          {t.iosSteps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      ) : state === "unsupported" ? (
        <p style={{ margin: 0, fontSize: 15 }}>{t.unsupported}</p>
      ) : state === "blocked" ? (
        <p style={{ margin: 0, fontSize: 15 }}>{t.blocked}</p>
      ) : state === "on" ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ flex: 1, fontWeight: 600, color: "var(--wc-mint-text)" }}>{t.on}</span>
          <button type="button" className="wc-pill" onClick={turnOff} style={{ cursor: "pointer" }}>
            {t.off}
          </button>
        </div>
      ) : (
        <>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5 }}>{t.body}</p>
          {state === "error" && <p style={{ margin: 0, color: "var(--wc-coral-text)", fontSize: 14 }}>{t.error}</p>}
          <button type="button" className="wc-btn" disabled={state === "busy"} onClick={turnOn}>
            🔔 {t.turnOn}
          </button>
        </>
      )}
      {install && !standalone() && state !== "ios_install" && (
        <button
          type="button"
          className="wc-btn"
          style={{ background: "var(--wc-mint)", color: "var(--wc-mint-ink)" }}
          onClick={async () => {
            await install.prompt();
            await install.userChoice;
            setInstall(null);
          }}
        >
          📲 {t.install}
        </button>
      )}
    </section>
  );
}
