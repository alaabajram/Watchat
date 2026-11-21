// Top bar for viewer pages (dark): logo (or a back link) · search · Ping balance (opens the wallet) · get Ping.
// A label's own logo from Admin → Brand & site replaces the Watchat wordmark.

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { ChevronIcon, GiftIcon, SearchIcon } from "@/components/brand/icons";
import { DEFAULT_SITE } from "@/lib/site/brand";
import { getSiteSafe } from "@/lib/site/store";
import { webCopy, type Locale } from "@/lib/web-copy";
import { PingIcon } from "@/components/brand/PingIcon";

export async function TopBar({ locale, balance, backHref, backLabel, dark = true }: { locale: Locale; balance: number; backHref?: string; backLabel?: string; dark?: boolean }) {
  const t = webCopy(locale);
  const site = await getSiteSafe();
  const custom = (dark ? site.logoOnDark !== DEFAULT_SITE.logoOnDark : site.logoOnLight !== DEFAULT_SITE.logoOnLight);
  const logo = custom
    ? dark ? site.logoOnDark : site.logoOnLight
    : `/brand/wordmark-${locale === "en" ? "en" : "ar"}-${dark ? "white" : "dark"}.png`;
  const round = dark ? "var(--wc-card, #1c1824)" : "#ffffff";
  return (
    <header className="topbar">
      {backHref ? (
        <Link className="chip" href={backHref} style={dark ? { background: round, color: "#fff" } : undefined}>
          {/* back = against reading direction */}
          <ChevronIcon size={18} rtl={locale !== "ar"} />
          {backLabel ?? t.back}
        </Link>
      ) : (
        <Link href="/" aria-label={t.home} style={{ display: "flex", alignItems: "center", minHeight: 44 }}>
          <img src={logo} alt={locale === "en" ? site.nameEn : site.nameAr} style={{ height: 30, width: "auto", display: "block" }} />
        </Link>
      )}
      <nav style={{ display: "flex", gap: 8 }} aria-label={t.wallet}>
        <Link href="/explore#search" aria-label={t.searchSeries} style={{ width: 44, height: 44, borderRadius: "50%", background: round, display: "grid", placeItems: "center", color: dark ? "#fff" : undefined }}>
          <SearchIcon />
        </Link>
        <Link className="chip" href="/wallet" aria-label={`${t.balance}: ${t.coins(balance)}`} style={dark ? { background: round, color: "#fff" } : undefined}>
          <PingIcon size={22} />
          {balance}
        </Link>
        <Link href="/store" aria-label={t.getCoins} style={{ width: 44, height: 44, borderRadius: "50%", background: round, display: "grid", placeItems: "center", position: "relative" }}>
          <GiftIcon color="#ff5a48" />
          <span aria-hidden="true" style={{ position: "absolute", top: 8, insetInlineEnd: 9, width: 9, height: 9, borderRadius: "50%", background: "#ff5a48", border: `2px solid ${round}` }} />
        </Link>
      </nav>
    </header>
  );
}
