// The neon top bar shared by Home and Heroes: logo + LIVE, Ping balance (opens the wallet), alerts bell.

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { PingIcon } from "@/components/brand/PingIcon";
import { DEFAULT_SITE } from "@/lib/site/brand";
import { getSiteSafe } from "@/lib/site/store";

export async function PlayHeader({ locale, balance }: { locale: "ar" | "en"; balance: number }) {
  const site = await getSiteSafe();
  const ar = locale === "ar";
  const logo = site.logoOnDark !== DEFAULT_SITE.logoOnDark ? site.logoOnDark : `/brand/wordmark-${ar ? "ar" : "en"}-white.png`;
  return (
    <header className="hm-head">
      <Link href="/" className="hm-brand" aria-label="Watchat">
        <img src={logo} alt="Watchat" style={{ height: 26, width: "auto", display: "block" }} />
        <span className="hm-live">{ar ? "مباشر" : "Live"}</span>
      </Link>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Link href="/wallet" className="hm-ping" aria-label={`Ping: ${balance}`}>
          <PingIcon size={18} />
          {balance}
        </Link>
        <Link href="/today#alerts" className="hm-bell" aria-label={ar ? "التنبيهات" : "Alerts"}>
          🔔
        </Link>
      </div>
    </header>
  );
}
