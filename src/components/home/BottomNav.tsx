// Bottom bar on every viewer page: Home · Explore · (Rewards, the raised coral button) · My List · Profile.
// The wallet isn't here: the Ping balance is in the top bar and the wallet opens from it and from Profile.

import Link from "next/link";
import { BookmarkIcon, ExploreIcon, GiftIcon, HomeIcon, UserIcon } from "@/components/brand/icons";
import { webCopy, type Locale } from "@/lib/web-copy";

export type NavKey = "home" | "explore" | "rewards" | "list" | "profile" | null;

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
          <Link href="/explore" aria-current={cur("explore")}>
            <ExploreIcon fill={on("explore") ? coral : "none"} color={on("explore") ? coral : "currentColor"} />
            {t.explore}
          </Link>
        </li>
        <li>
          <Link href="/rewards" aria-current={cur("rewards")} style={{ color: on("rewards") ? coral : "var(--wc-ink)" }}>
            <span className="wc-fab">
              <GiftIcon color="#fff" size={26} />
            </span>
            {t.rewardsNav}
          </Link>
        </li>
        <li>
          <Link href="/list" aria-current={cur("list")}>
            <BookmarkIcon fill={on("list") ? coral : "none"} color={on("list") ? coral : "currentColor"} />
            {t.myList}
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
