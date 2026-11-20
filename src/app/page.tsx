// watchat.pro — one address, two doors:
// • no session on this browser → splash with the animated logo and "Start in WhatsApp" (new viewers come in
//   through the bot; the personal link it sends signs this browser in);
// • a session → the home screen (banner carousel, continue watching, explore).
// The browser is recognised by the HttpOnly session cookie that src/proxy.ts keeps renewing.

import { Splash } from "@/components/brand/Splash";
import { HomeScreen } from "@/components/home/HomeScreen";
import { getHome } from "@/lib/content";
import { env } from "@/lib/env";
import { getSessionViewer } from "@/lib/session";
import { getBalance } from "@/lib/wallet";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ lang?: string; genre?: string }> }) {
  const params = await searchParams;
  const viewer = await getSessionViewer();

  if (!viewer) {
    const locale = params.lang === "en" ? "en" : "ar";
    const wa = env.waDisplayNumber ? `https://wa.me/${env.waDisplayNumber}?text=${encodeURIComponent(locale === "en" ? "START" : "ابدأ")}` : null;
    return <Splash locale={locale} waHref={wa} />;
  }

  const [{ catalogue, watching }, balance] = await Promise.all([getHome(viewer.id), getBalance(viewer.id)]);
  return <HomeScreen locale={viewer.uiLocale} balance={balance} catalogue={catalogue} watching={watching} genre={params.genre ?? null} />;
}
