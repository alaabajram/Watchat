"use client";

// Inside Telegram (Mini App): take the whole screen like an app.
// - Phones: full screen (Bot API 8.0+, no Telegram header), otherwise at least full height (expand).
// - Swiping down no longer closes the Mini App (the watch feed scrolls vertically).
// - Telegram's floating Close / ⋯ buttons sit over the top of the page in full screen, so the page is pushed
//   down by --wc-tg-top (Telegram's safe area + its button row).
// Outside Telegram this does nothing and never loads Telegram's script.

import { useEffect } from "react";
import { loadTelegramScript, telegramInitData } from "./TelegramSignIn";

type Inset = { top?: number };
type MiniApp = {
  platform?: string;
  isFullscreen?: boolean;
  safeAreaInset?: Inset;
  contentSafeAreaInset?: Inset;
  ready?: () => void;
  expand?: () => void;
  requestFullscreen?: () => void;
  disableVerticalSwipes?: () => void;
  isVersionAtLeast?: (v: string) => boolean;
  onEvent?: (name: string, cb: () => void) => void;
};

const inTelegram = () =>
  Boolean(telegramInitData()) || Boolean((window as unknown as { TelegramWebviewProxy?: unknown }).TelegramWebviewProxy);

export function TelegramMiniApp() {
  useEffect(() => {
    if (!inTelegram()) return;
    let cancelled = false;
    void loadTelegramScript().then(() => {
      const app = (window as unknown as { Telegram?: { WebApp?: MiniApp } }).Telegram?.WebApp;
      if (cancelled || !app?.ready) return;
      const root = document.documentElement;
      const setTop = () => {
        const top = app.isFullscreen ? (app.safeAreaInset?.top ?? 0) + (app.contentSafeAreaInset?.top ?? 0) : 0;
        root.style.setProperty("--wc-tg-top", `${top}px`);
      };
      app.ready();
      app.expand?.();
      if (app.isVersionAtLeast?.("7.7")) app.disableVerticalSwipes?.();
      const phone = /android|ios/i.test(app.platform ?? "");
      if (phone && app.isVersionAtLeast?.("8.0") && !app.isFullscreen) {
        try {
          app.requestFullscreen?.();
        } catch {
          // Older Telegram: expand() already gave the full height.
        }
      }
      for (const ev of ["fullscreenChanged", "safeAreaChanged", "contentSafeAreaChanged", "viewportChanged"]) app.onEvent?.(ev, setTop);
      setTop();
      root.classList.add("wc-in-telegram");
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
