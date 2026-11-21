"use client";

// Reads Telegram's launch data from the address (#tgWebAppData=…; no Telegram script needed), signs in through
// /api/telegram/auth and moves on. Opened outside Telegram, it explains where to open it.

import { useEffect, useState } from "react";

export function TelegramEntry({ to }: { to: string | null }) {
  const [state, setState] = useState<"working" | "outside" | "failed">("working");

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const initData = hash.get("tgWebAppData");
    if (!initData) {
      setState("outside");
      return;
    }
    fetch("/api/telegram/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ initData, to }) })
      .then((r) => r.json().catch(() => ({})))
      .then((j: { ok?: boolean; to?: string }) => {
        if (j.ok && j.to) window.location.replace(j.to);
        else setState("failed");
      })
      .catch(() => setState("failed"));
  }, [to]);

  return (
    <main className="page center" dir="rtl" lang="ar" style={{ minHeight: "100dvh", display: "grid", placeItems: "center", textAlign: "center", gap: 12 }}>
      {state === "working" && <p aria-live="polite">جاري الدخول… · Signing you in…</p>}
      {state === "outside" && <p>افتح واتشات من بوت تيليجرام · Open Watchat from the Telegram bot.</p>}
      {state === "failed" && (
        <p>
          ما قدرنا ندخّلك. سكّر الصفحة وافتحها من البوت مرة ثانية.
          <br />
          Couldn&apos;t sign you in. Close and reopen it from the bot.
        </p>
      )}
    </main>
  );
}
