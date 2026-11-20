// Bottom bar from the design team's screens, on every viewer page: Home · My List · (get coins) · Wallet · Profile.

import Link from "next/link";
import { BookmarkIcon, GiftIcon, HomeIcon, UserIcon, WalletIcon } from "@/components/brand/icons";
import { webCopy, type Locale } from "@/lib/web-copy";

export type NavKey = "home" | "list" | "coins" | "wallet" | "profile" | null;

export function BottomNav({ locale, current }: { locale: Locale; current: NavKey }) {
  const t = webCopy(locale);
  const on = (k: NavKey) => k === current;
  const cur = (k: NavKey) => (on(k) ? ("page" as const) : undefined);
  const coral = "var(--wc-coral, #ff5a48)";
  return (
    <nav className="wc-nav" aria-label={t.navLabel}>
      <ul>
        <li>
          <Link href="/" aria-current={cur("home")}>
            <HomeIcon fill={on("home") ? coral : "none"} color={on("home") ? coral : "currentColor"} />
            {t.home}
          </Link>
        </li>
        <li>
          <Link href="/list" aria-current={cur("list")}>
            <BookmarkIcon color={on("list") ? coral : "currentColor"} />
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
            <WalletIcon color={on("wallet") ? coral : "currentColor"} />
            {t.wallet}
          </Link>
        </li>
        <li>
          <Link href="/me" aria-current={cur("profile")}>
            <UserIcon fill={on("profile") ? coral : "none"} color={on("profile") ? coral : "currentColor"} />
            {t.profile}
          </Link>
        </li>
      </ul>
    </nav>
  );
}
