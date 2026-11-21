// The Watchat assistant on the web, and where the home-screen app opens. Signed-in viewers only.

import { AssistantChat } from "@/components/assistant/AssistantChat";
import { Splash } from "@/components/brand/Splash";
import { BottomNav } from "@/components/home/BottomNav";
import { TopBar } from "@/components/TopBar";
import { answerChip, TEXT } from "@/lib/assistant/engine";
import { assistantContext, withCards } from "@/lib/assistant/run";
import { env } from "@/lib/env";
import { ACCOUNT_WORD } from "@/lib/links";
import { getSessionViewer } from "@/lib/session";
import { getBalance } from "@/lib/wallet";
import { dirFor, webCopy } from "@/lib/web-copy";

export const dynamic = "force-dynamic";

export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const viewer = await getSessionViewer();
  if (!viewer) {
    const locale = (await searchParams).lang === "en" ? "en" : "ar";
    const t = webCopy(locale);
    const wa = env.waDisplayNumber ? `https://wa.me/${env.waDisplayNumber}?text=${encodeURIComponent(ACCOUNT_WORD)}` : null;
    return <Splash locale={locale} waHref={wa} cta={t.signInWithWhatsApp} hint={wa ? t.accountSignedOutBody : t.continueManual(ACCOUNT_WORD)} path="/assistant" />;
  }
  const locale = viewer.uiLocale;
  const [ctx, balance] = await Promise.all([assistantContext(viewer), getBalance(viewer.id)]);
  // The opening message: a greeting with picks (no AI).
  const picks = answerChip(ctx.watching.some((w) => w.resume !== null) ? "continue" : "recommend", ctx);
  const first = withCards({ ...picks, kind: "greeting", text: `${TEXT.greeting[locale]}` }, ctx);

  return (
    <div className="wc wc-app" dir={dirFor(locale)} lang={locale}>
      <TopBar locale={locale} balance={balance} />
      <main className="page" style={{ paddingTop: 4, paddingBottom: "calc(110px + env(safe-area-inset-bottom))", display: "flex", flexDirection: "column", gap: 8 }}>
        <header style={{ display: "flex", alignItems: "center", gap: 12, margin: "4px 0 8px" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/emblem-mint.png" alt="" width={34} height={46} />
          <div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>{locale === "en" ? "Watchat assistant" : "مساعد واتشات"}</h1>
            <p style={{ margin: 0, color: "var(--wc-muted)", fontSize: 14 }}>{locale === "en" ? "Series, search and offers" : "مسلسلات، بحث، وعروض"}</p>
          </div>
        </header>
        <AssistantChat locale={locale} first={first} />
      </main>
      <BottomNav locale={locale} current={null} />
    </div>
  );
}
