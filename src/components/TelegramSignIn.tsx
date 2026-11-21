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

type TgWebApp = { initData?: string; openInvoice?: (url: string, cb: (status: string) => void) => void };
const tgApp = (): TgWebApp | undefined => (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp;

/** Load Telegram's Mini App script once (only when a Telegram viewer pays). */
function loadTelegramScript(): Promise<void> {
  if (tgApp()?.openInvoice) return Promise.resolve();
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "https://telegram.org/js/telegram-web-app.js";
    s.onload = () => resolve();
    s.onerror = () => resolve();
    document.head.appendChild(s);
  });
}

/**
 * Open Telegram's payment sheet for a Stars invoice. Inside Telegram it opens over the page and resolves with
 * "paid", "cancelled", "failed" or "pending"; outside Telegram the invoice link opens in Telegram.
 */
export async function openTelegramInvoice(url: string): Promise<string> {
  await loadTelegramScript();
  const app = tgApp();
  if (app?.openInvoice && app.initData) {
    return new Promise((resolve) => app.openInvoice!(url, (status) => resolve(status)));
  }
  window.location.href = url;
  return "opened";
}
