// Page frame for Playground pages: top bar (logo or back, Ping) · content · bottom nav.
// Signed-out visitors get the one sign-in page and come back to the same address after signing in.

import { Splash } from "@/components/brand/Splash";
import { BottomNav, type NavKey } from "@/components/home/BottomNav";
import { TopBar } from "@/components/TopBar";
import { doorSetup } from "@/lib/signin/server";
import { dirFor } from "@/lib/web-copy";

export function PlayShell({ locale, balance, nav, backHref, children }: { locale: "ar" | "en"; balance: number; nav: NavKey; backHref?: string; children: React.ReactNode }) {
  return (
    <div className="wc wc-app" dir={dirFor(locale)} lang={locale}>
      <TopBar locale={locale} balance={balance} backHref={backHref} />
      <main className="pl-page">{children}</main>
      <BottomNav locale={locale} current={nav} />
    </div>
  );
}

export async function SignedOut({ path, lang }: { path: string; lang?: string }) {
  const locale = lang === "en" ? "en" : "ar";
  const setup = await doorSetup({ waText: locale === "en" ? "START" : "ابدأ", to: path });
  return <Splash locale={locale} setup={setup} path={path} />;
}
