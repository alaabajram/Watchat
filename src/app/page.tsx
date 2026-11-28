// watchat.pro — one address, two doors:
// • no session on this browser → splash with the animated logo and every way in (Telegram, phone number, email,
//   and WhatsApp while it's sending; `SignInDoors`);
// • a session → the Playground home: your day (card, sign, question, streak), live rooms, AI People, Discover.

import Link from "next/link";
import { SignedOut } from "@/components/play/PlayShell";
import { HomeHeader } from "@/components/home/HomeScreen";
import { BottomNav } from "@/components/home/BottomNav";
import { HomeScreenTip } from "@/components/HomeScreenTip";
import { questionOfDay, SIGNS } from "@/lib/daily/daily";
import { cardById } from "@/lib/daily/tarot";
import { playCopy } from "@/lib/play/copy";
import { ensureStarter, liveRooms, livePeople, todayFor, touchHabit } from "@/lib/play/store";
import { AI_LABEL } from "@/lib/people/persona";
import { getSessionViewer } from "@/lib/session";
import { DEFAULT_SITE } from "@/lib/site/brand";
import { getSiteSafe } from "@/lib/site/store";
import { currentTenantId } from "@/lib/supabase";
import { getBalance } from "@/lib/wallet";
import { dirFor } from "@/lib/web-copy";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const params = await searchParams;
  const viewer = await getSessionViewer();
  if (!viewer) return <SignedOut path="/" lang={params.lang} />;

  const tenantId = await currentTenantId();
  await Promise.all([ensureStarter(tenantId), touchHabit(viewer.id)]);
  const locale = viewer.uiLocale;
  const ar = locale === "ar";
  const t = playCopy(locale);
  const [balance, site, today, rooms, people] = await Promise.all([getBalance(viewer.id), getSiteSafe(), todayFor(tenantId, viewer.id), liveRooms(tenantId, viewer.id), livePeople(tenantId)]);
  const logo = site.logoOnDark === DEFAULT_SITE.logoOnDark ? null : site.logoOnDark;
  const card = cardById(today.card.card);
  const sign = today.sign ? SIGNS.find((s) => s.key === today.sign) : null;
  const q = questionOfDay(today.day).q;
  const L = (a: string, e: string) => (ar ? a : e);

  return (
    <div className="wc wc-app" dir={dirFor(locale)} lang={locale}>
      <HomeHeader locale={locale} balance={balance} logo={logo} />
      <main className="pl-page">
        <section className="pl-hero">
          <h1 className="pl-h1">{t.tagline}</h1>
          <span className="pl-streak">🔥 {t.streak(today.streak)}</span>
          {today.streakPing ? <span className="pl-tag pl-tag-done pl-pop">{t.streakEarned(today.streakPing)}</span> : today.next ? <span className="pl-muted">{t.nextMilestone(today.next.left, today.next.ping)}</span> : null}
        </section>

        <section className="pl-section" aria-label={t.todayTitle}>
          <div className="pl-row">
            <h2 className="wc-section-title">{t.todayTitle}</h2>
            <Link className="wc-link" href="/today">{t.seeAll}</Link>
          </div>
          <div className="pl-rail">
            <Link href="/today" className="pl-card pl-tile" style={{ width: 160, ["--pl-accent" as string]: "#f5c242" }}>
              <span className="pl-emoji" aria-hidden="true">{today.card.drawn ? card.emoji : "🔮"}</span>
              <span className="pl-muted">{t.cardOfDay}</span>
              <span className="pl-title">{today.card.drawn ? L(card.nameAr, card.nameEn) : t.drawCard}</span>
            </Link>
            <Link href={sign ? "/horoscope" : "/today"} className="pl-card pl-tile" style={{ width: 160, ["--pl-accent" as string]: "#7c5cff" }}>
              <span className="pl-emoji" aria-hidden="true">{sign ? sign.symbol : "✨"}</span>
              <span className="pl-muted">{t.horoscope}</span>
              <span className="pl-title">{sign ? L(sign.ar, sign.en) : t.pickSign}</span>
            </Link>
            <Link href="/today" className="pl-card pl-tile" style={{ width: 200, ["--pl-accent" as string]: "#31e5a0" }}>
              <span className="pl-emoji" aria-hidden="true">{today.question.answer === null ? "❓" : "✅"}</span>
              <span className="pl-muted">{t.dailyQuestion}</span>
              <span className="pl-title" style={{ fontSize: 15 }}>{L(q.ar, q.en)}</span>
            </Link>
            <Link href="/fortune" className="pl-card pl-tile" style={{ width: 160, ["--pl-accent" as string]: "#ff9f43" }}>
              <span className="pl-emoji" aria-hidden="true">🃏</span>
              <span className="pl-muted">{t.fortune}</span>
              <span className="pl-title">{t.fortuneTitle}</span>
            </Link>
          </div>
        </section>

        {rooms.length ? (
          <section className="pl-section" aria-label={t.rooms}>
            <div className="pl-row">
              <h2 className="wc-section-title">{t.rooms}</h2>
              <Link className="wc-link" href="/rooms">{t.seeAll}</Link>
            </div>
            <div className="pl-rail">
              {rooms.map((r) => (
                <Link key={r.id} href={`/rooms/${r.slug}`} className="pl-card pl-room pl-room-rail" style={{ ["--pl-accent" as string]: r.color }}>
                  <div className="pl-row">
                    <span className="pl-emoji" aria-hidden="true">{r.emoji}</span>
                    {r.answered ? <span className="pl-tag pl-tag-done">{t.played}</span> : null}
                  </div>
                  <span className="pl-title" style={{ fontSize: 16 }}>{L(r.titleAr, r.titleEn)}</span>
                  <span className="pl-q">{r.round ? L(r.round.promptAr, r.round.promptEn) : t.noRound}</span>
                  <span className="pl-foot">
                    <span>{t.people(r.players)}</span>
                    <span className="wc-link">{t.play} →</span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {people.length ? (
          <section className="pl-section" aria-label={t.aiPeople}>
            <div className="pl-row">
              <h2 className="wc-section-title">{t.aiPeople}</h2>
              <Link className="wc-link" href="/people">{t.seeAll}</Link>
            </div>
            <div className="pl-rail">
              {people.map((p) => (
                <Link key={p.id} href={`/people/${p.slug}`} className="pl-card pl-person-rail" style={{ ["--pl-accent" as string]: p.color }}>
                  <span className="pl-avatar" aria-hidden="true">{p.emoji}</span>
                  <b>{L(p.nameAr, p.nameEn)}</b>
                  <span className="pl-muted wc-clamp2">{L(p.roleAr, p.roleEn)}</span>
                  <span className="pl-tag pl-tag-ai">{AI_LABEL[locale]}</span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        <section className="pl-section" aria-label={t.discover}>
          <div className="pl-row">
            <h2 className="wc-section-title">{t.discover}</h2>
            <Link className="wc-link" href="/discover">{t.seeAll}</Link>
          </div>
          <div className="pl-grid2">
            <Link href="/explore" className="pl-card pl-tile" style={{ ["--pl-accent" as string]: "#ff5a48" }}>
              <span className="pl-emoji" aria-hidden="true">🎬</span>
              <span className="pl-title">{t.stories}</span>
              <span className="pl-muted">{t.storiesHint}</span>
            </Link>
            <Link href="/rewards" className="pl-card pl-tile" style={{ ["--pl-accent" as string]: "#31e5a0" }}>
              <span className="pl-emoji" aria-hidden="true">🎁</span>
              <span className="pl-title">{t.rewards}</span>
              <span className="pl-muted">{t.rewardsHint}</span>
            </Link>
          </div>
        </section>
        <HomeScreenTip locale={locale} />
      </main>
      <BottomNav locale={locale} current="home" />
    </div>
  );
}
