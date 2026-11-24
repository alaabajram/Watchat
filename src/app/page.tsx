// watchat.pro — one address, two doors:
// • no session on this browser → splash with the animated logo and every way in (WhatsApp, Telegram, phone
//   number, email; `SignInDoors`);
// • a session → the home screen (banner carousel, continue watching, explore).
// The browser is recognised by the HttpOnly session cookie that src/proxy.ts keeps renewing.

import { Splash } from "@/components/brand/Splash";
import { HomeScreen } from "@/components/home/HomeScreen";
import { getHome } from "@/lib/content";
import { getSessionViewer } from "@/lib/session";
import { DEFAULT_SITE } from "@/lib/site/brand";
import { getSiteSafe } from "@/lib/site/store";
import { getBalance } from "@/lib/wallet";
import { doorSetup } from "@/lib/signin/server";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ lang?: string; genre?: string }> }) {
  const params = await searchParams;
  const viewer = await getSessionViewer();

  if (!viewer) {
    const locale = params.lang === "en" ? "en" : "ar";
    const setup = await doorSetup({ waText: locale === "en" ? "START" : "ابدأ", to: "/" });
    return <Splash locale={locale} setup={setup} />;
  }

  const [{ catalogue, watching }, balance, site] = await Promise.all([getHome(viewer.id), getBalance(viewer.id), getSiteSafe()]);
  const logo = site.logoOnDark === DEFAULT_SITE.logoOnDark ? null : site.logoOnDark; // a label's own logo (dark version), else the white Watchat wordmark
  return <HomeScreen locale={viewer.uiLocale} balance={balance} catalogue={catalogue} watching={watching} genre={params.genre ?? null} logo={logo} />;
}
