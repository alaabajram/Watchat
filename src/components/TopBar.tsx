// Top bar for viewer pages: back link, coin balance (opens wallet), settings.

import Link from "next/link";
import { webCopy, type Locale } from "@/lib/web-copy";

export function TopBar({ locale, balance, backHref, backLabel }: { locale: Locale; balance: number; backHref?: string; backLabel?: string }) {
  const t = webCopy(locale);
  return (
    <header className="topbar">
      {backHref ? (
        <Link className="chip" href={backHref}>
          {backLabel ?? "←"}
        </Link>
      ) : (
        <Link className="chip" href="/me">
          Watchat
        </Link>
      )}
      <nav style={{ display: "flex", gap: 8 }}>
        <Link className="chip" href="/wallet" aria-label={t.wallet}>
          🪙 {balance}
        </Link>
        <Link className="chip" href="/settings" aria-label={t.settings}>
          ⚙︎
        </Link>
      </nav>
    </header>
  );
}
