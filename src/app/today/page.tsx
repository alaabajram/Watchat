// Today: the daily habit page — card of the day, the daily question, your horoscope and your streak.

import Link from "next/link";
import { PlayShell, SignedOut } from "@/components/play/PlayShell";
import { TodayPanel } from "@/components/play/TodayPanel";
import { playCopy } from "@/lib/play/copy";
import { todayFor, touchHabit } from "@/lib/play/store";
import { getSessionViewer } from "@/lib/session";
import { currentTenantId } from "@/lib/supabase";
import { getBalance } from "@/lib/wallet";

export const dynamic = "force-dynamic";

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const viewer = await getSessionViewer();
  if (!viewer) return <SignedOut path="/today" lang={(await searchParams).lang} />;
  const tenantId = await currentTenantId();
  await touchHabit(viewer.id);
  const locale = viewer.uiLocale;
  const t = playCopy(locale);
  const [balance, today] = await Promise.all([getBalance(viewer.id), todayFor(tenantId, viewer.id)]);
  const date = new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Dubai" }).format(new Date());
  return (
    <PlayShell locale={locale} balance={balance} nav="today">
      <header className="pl-hero">
        <p className="pl-muted">{date}</p>
        <h1 className="pl-h1">{t.todayTitle}</h1>
        <span className="pl-streak">🔥 {t.streak(today.streak)}</span>
      </header>
      <TodayPanel initial={today} locale={locale} />
      <Link href="/fortune" className="pl-card pl-person" style={{ ["--pl-accent" as string]: "#ff9f43" }}>
        <span className="pl-avatar" aria-hidden="true">🃏</span>
        <div>
          <b>{t.fortuneTitle}</b>
          <div className="pl-muted">{t.readingCta(today.readingPing)}</div>
        </div>
      </Link>
    </PlayShell>
  );
}
