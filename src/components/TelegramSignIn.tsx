"use client";

// "Sign in with Telegram" (Telegram blue). Inside Telegram, the Mini App's signed launch data (kept for this tab)
// signs the viewer in at once — automatically when the page was opened with it. Outside Telegram, the button
// opens the Watchat bot.

import { useEffect, useState } from "react";


const INIT_KEY = "wc_tg_init";

export function telegramInitData(): string | null {
  if (typeof window === "undefined") return null;
  const fromHash = new URLSearchParams(window.location.hash.slice(1)).get("tgWebAppData");
  try {
    if (fromHash) sessionStorage.setItem(INIT_KEY, fromHash);
    return fromHash ?? sessionStorage.getItem(INIT_KEY);
  } catch {
    return fromHash;
  }
}

export async function signInWithTelegram(initData: string, to: string | null): Promise<string | null> {
  const r = await fetch("/api/telegram/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ initData, to }) });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; to?: string };
  return j.ok && j.to ? j.to : null;
}

export function TelegramPlane({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M21.4 3.6 2.9 10.8c-1 .4-1 1.8.1 2.1l4.6 1.4 1.8 5.6c.3.9 1.4 1.1 2 .4l2.6-2.7 4.7 3.5c.8.6 1.9.1 2.1-.9l3-14.5c.3-1.2-.9-2.2-2.2-1.7zM9.6 14.2l8-7.2-6.5 8.2-.4 3.3-1.1-4.3z" />
    </svg>
  );
}

export function TelegramSignIn({ href, label, to }: { href: string | null; label: string; to: string }) {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Opened by Telegram with fresh launch data: sign in without a tap.
    if (!new URLSearchParams(window.location.hash.slice(1)).get("tgWebAppData")) return;
    const init = telegramInitData();
    if (!init) return;
    setBusy(true);
    void signInWithTelegram(init, to).then((next) => (next ? window.location.replace(next) : setBusy(false)));
  }, [to]);

  async function go() {
    const init = telegramInitData();
    if (init) {
      setBusy(true);
      const next = await signInWithTelegram(init, to);
      if (next) return window.location.replace(next);
      setBusy(false);
    }
    if (href) window.location.href = href;
  }

  return (
    <button type="button" className="wc-btn wc-btn-tg" onClick={go} disabled={busy} style={{ minHeight: 60, width: "100%" }}>
      <TelegramPlane />
      {label}
    </button>
  );
}
