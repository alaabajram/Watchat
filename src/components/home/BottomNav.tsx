// Bottom bar on every viewer page: Home · Rooms · Today (the raised coral button: card, horoscope, daily question)
// · AI People · Profile. Stories, rewards and My List are reached from Discover (Home) and Profile; the wallet
// opens from the Ping balance in the top bar.

import Link from "next/link";
import { BotIcon, HomeIcon, RoomsIcon, SparkIcon, UserIcon } from "@/components/brand/icons";
import { webCopy, type Locale } from "@/lib/web-copy";

export type NavKey = "home" | "rooms" | "today" | "people" | "profile" | "explore" | "rewards" | "list" | null;

const LABELS = {
  ar: { rooms: "الغرف", today: "اليوم", people: "شخصيات" },
  en: { rooms: "Rooms", today: "Today", people: "Heroes" },
} as const;

export function BottomNav({ locale, current }: { locale: Locale; current: NavKey }) {
  const t = webCopy(locale);
  const l = LABELS[locale];
  const on = (k: NavKey) => k === current;
  const cur = (k: NavKey) => (on(k) ? ("page" as const) : undefined);
  const coral = "var(--wc-coral, #ff5a48)";
  const tint = (k: NavKey) => ({ fill: on(k) ? coral : "none", color: on(k) ? coral : "currentColor" });
  return (
    <nav className="wc-nav" aria-label={t.navLabel}>
      <ul>
        <li>
          <Link href="/" aria-current={cur("home")}>
            <HomeIcon {...tint("home")} />
            {t.home}
          </Link>
        </li>
        <li>
          <Link href="/rooms" aria-current={cur("rooms")}>
            <RoomsIcon color={tint("rooms").color} />
            {l.rooms}
          </Link>
        </li>
        <li>
          <Link href="/today" aria-current={cur("today")} style={{ color: on("today") ? coral : "var(--wc-ink)" }}>
            <span className="wc-fab">
              <SparkIcon color="#fff" size={26} />
            </span>
            {l.today}
          </Link>
        </li>
        <li>
          <Link href="/people" aria-current={cur("people")}>
            <BotIcon color={tint("people").color} />
            {l.people}
          </Link>
        </li>
        <li>
          <Link href="/me" aria-current={cur("profile")}>
            <UserIcon {...tint("profile")} />
            {t.profile}
          </Link>
        </li>
      </ul>
    </nav>
  );
}
