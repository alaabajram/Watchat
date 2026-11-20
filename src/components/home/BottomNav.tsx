// Bottom bar from the design team's screens. Coral "get coins" button in the middle.

import Link from "next/link";
import { BookmarkIcon, GiftIcon, HomeIcon, SettingsIcon, WalletIcon } from "@/components/brand/icons";
import { webCopy, type Locale } from "@/lib/web-copy";

export type NavKey = "home" | "list" | "coins" | "wallet" | "settings";

export function BottomNav({ locale, current }: { locale: Locale; current: NavKey }) {
  const t = webCopy(locale);
  const cur = (k: NavKey) => (k === current ? ("page" as const) : undefined);
  return (
    <nav className="wc-nav" aria-label={t.navLabel}>
      <ul>
        <li>
          <Link href="/" aria-current={cur("home")}>
            <HomeIcon fill={current === "home" ? "#ff5a48" : "none"} color={current === "home" ? "#ff5a48" : "currentColor"} />
            {t.home}
          </Link>
        </li>
        <li>
          <Link href="/me" aria-current={cur("list")}>
            <BookmarkIcon />
            {t.myList}
          </Link>
        </li>
        <li>
          <Link href="/store" aria-current={cur("coins")} style={{ color: "var(--wc-ink)" }}>
            <span className="wc-fab">
              <GiftIcon color="#fff" size={22} />
            </span>
            {t.getCoins}
          </Link>
        </li>
        <li>
          <Link href="/wallet" aria-current={cur("wallet")}>
            <WalletIcon />
            {t.wallet}
          </Link>
        </li>
        <li>
          <Link href="/settings" aria-current={cur("settings")}>
            <SettingsIcon />
            {t.settings}
          </Link>
        </li>
      </ul>
    </nav>
  );
}
