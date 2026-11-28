// Fortune Teller: the three-card reading (Ping) and the viewer's past readings. Entertainment and reflection.

import Link from "next/link";
import { FortuneReading } from "@/components/play/FortuneReading";
import { PlayShell, SignedOut } from "@/components/play/PlayShell";
import { cardById } from "@/lib/daily/tarot";
import { playCopy } from "@/lib/play/copy";
import { myReadings, todayFor } from "@/lib/play/store";
import { getSessionViewer } from "@/lib/session";
import { currentTenantId } from "@/lib/supabase";
import { getBalance } from "@/lib/wallet";

export const dynamic = "force-dynamic";

export default async function FortunePage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const viewer = await getSessionViewer();
  if (!viewer) return <SignedOut path="/fortune" lang={(await searchParams).lang} />;
  const tenantId = await currentTenantId();
  const locale = viewer.uiLocale;
  const t = playCopy(locale);
  const [balance, today, past] = await Promise.all([getBalance(viewer.id), todayFor(tenantId, viewer.id), myReadings(viewer.id)]);
  const card = cardById(today.card.card);
  return (
    <PlayShell locale={locale} balance={balance} nav="today" backHref="/today">
      <header className="pl-hero">
        <h1 className="pl-h1">🔮 {t.fortune}</h1>
        <p className="pl-sub">{t.disclaimer}</p>
      </header>
      <Link href="/today" className="pl-card pl-person" style={{ ["--pl-accent" as string]: "#f5c242" }}>
        <span className="pl-avatar" aria-hidden="true">{today.card.drawn ? card.emoji : "🔮"}</span>
        <div>
          <b>{t.cardOfDay}</b>
          <div className="pl-muted">{today.card.drawn ? (locale === "ar" ? card.nameAr : card.nameEn) : t.drawCard}</div>
        </div>
      </Link>
      <FortuneReading locale={locale} price={today.readingPing} past={past} />
    </PlayShell>
  );
}
