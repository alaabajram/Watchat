/* eslint-disable @next/next/no-img-element */
// AI People: the personality cards. Each is an AI character (labelled) the team manages in Admin → AI People.

import Link from "next/link";
import { PlayShell, SignedOut } from "@/components/play/PlayShell";
import { playCopy } from "@/lib/play/copy";
import { AI_LABEL } from "@/lib/people/persona";
import { ensureStarter, livePeople } from "@/lib/play/store";
import { getSessionViewer } from "@/lib/session";
import { currentTenantId } from "@/lib/supabase";
import { getBalance } from "@/lib/wallet";

export const dynamic = "force-dynamic";

export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const viewer = await getSessionViewer();
  if (!viewer) return <SignedOut path="/people" lang={(await searchParams).lang} />;
  const tenantId = await currentTenantId();
  await ensureStarter(tenantId);
  const locale = viewer.uiLocale;
  const t = playCopy(locale);
  const L = (a: string, e: string) => (locale === "ar" ? a : e);
  const [balance, people] = await Promise.all([getBalance(viewer.id), livePeople(tenantId)]);
  return (
    <PlayShell locale={locale} balance={balance} nav="people">
      <header className="pl-hero">
        <h1 className="pl-h1">{t.aiPeopleTitle}</h1>
        <p className="pl-sub">{t.aiPeopleHint}</p>
      </header>
      <div className="pl-section">
        {people.map((p) => (
          <Link key={p.id} href={`/people/${p.slug}`} className="pl-card pl-person" style={{ ["--pl-accent" as string]: p.color }}>
            <span className="pl-avatar" aria-hidden="true">{p.image ? <img src={p.image} alt="" /> : p.emoji}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="pl-row">
                <b style={{ fontSize: 17 }}>{L(p.nameAr, p.nameEn)}</b>
                <span className="pl-tag pl-tag-ai">{AI_LABEL[locale]}</span>
              </div>
              <div className="pl-muted">{L(p.roleAr, p.roleEn)}</div>
            </div>
          </Link>
        ))}
      </div>
    </PlayShell>
  );
}
