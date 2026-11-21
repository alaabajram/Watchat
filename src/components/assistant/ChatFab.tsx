"use client";

// The floating "Chat" button to the Watchat assistant, on every viewer page. It stays off the full-screen watch
// feed (never interrupt watching), the assistant itself, the admin and the public business pages. It sits above the
// bottom nav when the page has one, and follows the page's language (pages set lang on their own wrapper).

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AgentIcon } from "./AgentIcon";

const HIDDEN = [/^\/watch(\/|$)/, /^\/assistant(\/|$)/, /^\/admin(\/|$)/, /^\/business(\/|$)/, /^\/w\//, /^\/payment(\/|$)/, /^\/link-expired/, /^\/data-deletion/, /^\/tg(\/|$)/];

export function chatFabHidden(path: string): boolean {
  return HIDDEN.some((r) => r.test(path));
}

export function ChatFab() {
  const path = usePathname() ?? "/";
  const [layout, setLayout] = useState<{ en: boolean; nav: boolean; off: boolean } | null>(null);

  useEffect(() => {
    // Read after the page has rendered: its language and whether it has the bottom nav.
    const read = () =>
      setLayout({
        en: document.querySelector("[lang]:not(html)")?.getAttribute("lang") === "en",
        nav: Boolean(document.querySelector(".wc-nav")),
        off: Boolean(document.querySelector("[data-no-chat]")), // sign-in screens: the assistant needs an account
      });
    read();
    const t = window.setTimeout(read, 300);
    return () => window.clearTimeout(t);
  }, [path]);

  if (chatFabHidden(path) || !layout || layout.off) return null;
  const back = encodeURIComponent(path);
  return (
    <Link
      href={`/assistant?back=${back}`}
      aria-label={layout.en ? "Chat with Watchat" : "شات مع واتشات"}
      className="wc-agent-float wc-chat-fab"
      dir={layout.en ? "ltr" : "rtl"}
      style={{ bottom: layout.nav ? "calc(96px + env(safe-area-inset-bottom))" : "calc(20px + env(safe-area-inset-bottom))" }}
    >
      <AgentIcon height={38} />
      {layout.en ? "Chat" : "شات"}
    </Link>
  );
}
