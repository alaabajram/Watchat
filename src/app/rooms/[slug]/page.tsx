// One room: today's round, then the results and a share card. Links to this page are what viewers share.

import { notFound } from "next/navigation";
import Link from "next/link";
import { PlayShell, SignedOut } from "@/components/play/PlayShell";
import { RoomPlay } from "@/components/play/RoomPlay";
import { trackEvent } from "@/lib/events";
import { playCopy } from "@/lib/play/copy";
import { liveRooms, roomView } from "@/lib/play/store";
import { getSessionViewer } from "@/lib/session";
import { currentTenantId } from "@/lib/supabase";
import { getBalance } from "@/lib/wallet";

export const dynamic = "force-dynamic";

export default async function RoomPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ lang?: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{2,40}$/.test(slug)) notFound();
  const viewer = await getSessionViewer();
  if (!viewer) return <SignedOut path={`/rooms/${slug}`} lang={(await searchParams).lang} />;
  const tenantId = await currentTenantId();
  const view = await roomView(tenantId, slug, viewer.id);
  if (!view) notFound();
  const locale = viewer.uiLocale;
  const t = playCopy(locale);
  const L = (a: string, e: string) => (locale === "ar" ? a : e);
  const [balance, others] = await Promise.all([getBalance(viewer.id), liveRooms(tenantId, viewer.id), trackEvent({ viewerHmac: viewer.phoneHmac, name: "room_view", props: { room: slug } })]);
  const { room } = view;
  return (
    <PlayShell locale={locale} balance={balance} nav="rooms" backHref="/rooms">
      <header className="pl-card" style={{ ["--pl-accent" as string]: room.color }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span className="pl-emoji" style={{ fontSize: 40 }} aria-hidden="true">{room.emoji}</span>
          <div>
            <h1 className="pl-title" style={{ fontSize: 21 }}>{L(room.titleAr, room.titleEn)}</h1>
            <p className="pl-muted">{L(room.blurbAr, room.blurbEn)}</p>
          </div>
        </div>
      </header>
      <RoomPlay initial={view} locale={locale} />
      {others.filter((r) => r.slug !== slug).length ? (
        <section className="pl-section">
          <h2 className="wc-section-title">{t.rooms}</h2>
          <div className="pl-rail">
            {others
              .filter((r) => r.slug !== slug)
              .map((r) => (
                <Link key={r.id} href={`/rooms/${r.slug}`} className="pl-card pl-room pl-room-rail" style={{ ["--pl-accent" as string]: r.color, minHeight: 120 }}>
                  <span className="pl-emoji" aria-hidden="true">{r.emoji}</span>
                  <span className="pl-title" style={{ fontSize: 16 }}>{L(r.titleAr, r.titleEn)}</span>
                  <span className="pl-foot">{r.answered ? <span className="pl-tag pl-tag-done">{t.played}</span> : <span className="wc-link">{t.play} →</span>}</span>
                </Link>
              ))}
          </div>
        </section>
      ) : null}
    </PlayShell>
  );
}
