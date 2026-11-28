// Rooms: every live room with today's round. A room is configuration (Admin → Rooms), so this list grows
// without code.

import Link from "next/link";
import { PlayShell, SignedOut } from "@/components/play/PlayShell";
import { playCopy } from "@/lib/play/copy";
import { ensureStarter, liveRooms } from "@/lib/play/store";
import { getSessionViewer } from "@/lib/session";
import { currentTenantId } from "@/lib/supabase";
import { getBalance } from "@/lib/wallet";

export const dynamic = "force-dynamic";

export default async function RoomsPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const viewer = await getSessionViewer();
  if (!viewer) return <SignedOut path="/rooms" lang={(await searchParams).lang} />;
  const tenantId = await currentTenantId();
  await ensureStarter(tenantId);
  const locale = viewer.uiLocale;
  const t = playCopy(locale);
  const L = (a: string, e: string) => (locale === "ar" ? a : e);
  const [balance, rooms] = await Promise.all([getBalance(viewer.id), liveRooms(tenantId, viewer.id)]);
  return (
    <PlayShell locale={locale} balance={balance} nav="rooms">
      <header className="pl-hero">
        <h1 className="pl-h1">{t.roomsTitle}</h1>
        <p className="pl-sub">{t.roomsHint}</p>
      </header>
      <div className="pl-section">
        {rooms.map((r) => (
          <Link key={r.id} href={`/rooms/${r.slug}`} className="pl-card pl-room" style={{ ["--pl-accent" as string]: r.color, minHeight: 0 }}>
            <div className="pl-row">
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <span className="pl-emoji" aria-hidden="true">{r.emoji}</span>
                <div>
                  <div className="pl-title">{L(r.titleAr, r.titleEn)}</div>
                  <div className="pl-muted">{L(r.blurbAr, r.blurbEn)}</div>
                </div>
              </div>
              {r.answered ? <span className="pl-tag pl-tag-done">{t.played}</span> : null}
            </div>
            <span className="pl-q">{r.round ? L(r.round.promptAr, r.round.promptEn) : t.noRound}</span>
            <span className="pl-foot">
              <span>{t.people(r.players)}</span>
              <span className="wc-link">{t.play} →</span>
            </span>
          </Link>
        ))}
        {!rooms.length ? <p className="pl-sub">{t.noRound}</p> : null}
      </div>
    </PlayShell>
  );
}
