// Rooms: the arena lobby in the neon look — header with the countdown to the next round, group tabs, the weekly
// jackpot banner (with the viewer's score), the main-stage room, the arena grid and quick match. Rooms are
// configuration (Admin → Rooms: picture, label, group, button, place); page texts are in Admin → Home page.

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { BottomNav } from "@/components/home/BottomNav";
import { Countdown } from "@/components/play/Countdown";
import { PlayHeader } from "@/components/play/PlayHeader";
import { SignedOut } from "@/components/play/PlayShell";
import { groupKey } from "@/lib/people/card";
import { compact, homeLayout, type L } from "@/lib/play/home";
import { ensureStarter, homeContent, liveRooms, playSettings, weeklyScore, type RoomCard } from "@/lib/play/store";
import { CROWD_WORD, DEFAULT_CTA, secondsToNextRound } from "@/lib/rooms/display";
import { getSessionViewer } from "@/lib/session";
import { currentTenantId } from "@/lib/supabase";
import { getBalance } from "@/lib/wallet";
import { dirFor } from "@/lib/web-copy";

export const dynamic = "force-dynamic";

const UI = {
  ar: {
    resets: "الجولة الجاية بعد",
    online: (n: number) => `${n} شغّالة`,
    all: (n: number) => `كل الغرف (${n})`,
    prize: (p: number) => `${p} بينج جائزة`,
    score: (n: number, rank: number | null) => (n === 0 ? "ما عندك إجابات صح هالأسبوع — جرّب!" : `هالأسبوع: ${n} صح${rank ? ` · المركز ${rank}` : ""}`),
    rules: "القوانين",
    round: (n: number) => `الجولة ${n} شغّالة`,
    reward: (p: number) => `+${p} بينج مكافأة`,
    logged: (n: string) => `${n} إجابة اليوم`,
    live: (n: string) => `${n} مباشر`,
    played: "جاوبت ✓",
    none: "ما في غرف بهالقسم الحين.",
  },
  en: {
    resets: "Round resets",
    online: (n: number) => `${n} online`,
    all: (n: number) => `All rooms (${n})`,
    prize: (p: number) => `${p} Ping prize`,
    score: (n: number, rank: number | null) => (n === 0 ? "No right answers this week yet — have a go!" : `This week: ${n} right${rank ? ` · #${rank}` : ""}`),
    rules: "Rules",
    round: (n: number) => `Round ${n} active`,
    reward: (p: number) => `+${p} Ping reward`,
    logged: (n: string) => `${n} answers logged`,
    live: (n: string) => `${n} live`,
    played: "Answered ✓",
    none: "No rooms in this group right now.",
  },
};

export default async function RoomsPage({ searchParams }: { searchParams: Promise<{ lang?: string; group?: string }> }) {
  const sp = await searchParams;
  const viewer = await getSessionViewer();
  if (!viewer) return <SignedOut path="/rooms" lang={sp.lang} />;
  const tenantId = await currentTenantId();
  await ensureStarter(tenantId);
  const locale = viewer.uiLocale;
  const ar = locale === "ar";
  const u = UI[locale];
  const T = (x: L) => (ar ? x.ar || x.en : x.en || x.ar);
  const R = (a: string, e: string) => (ar ? a || e : e || a);
  const [balance, rooms, score, content, settings] = await Promise.all([
    getBalance(viewer.id),
    liveRooms(tenantId, viewer.id),
    weeklyScore(tenantId, viewer.id),
    homeContent(tenantId),
    playSettings(tenantId),
  ]);
  const page = content.roomsPage;

  // Group tabs from the rooms' own groups.
  const groups: { key: string; ar: string; en: string }[] = [];
  for (const r of rooms) {
    const name = r.groupEn || r.groupAr;
    if (name && !groups.some((g) => g.key === groupKey(name))) groups.push({ key: groupKey(name), ar: r.groupAr || r.groupEn, en: r.groupEn || r.groupAr });
  }
  const group = groups.some((g) => g.key === sp.group) ? sp.group : null;
  const shown = group ? rooms.filter((r) => groupKey(r.groupEn || r.groupAr) === group) : rooms;
  // The main stage is the Home hero (when it's in this view); the rest fill the grid.
  const { hero } = homeLayout(shown.map((r) => (r.homeSlot === "hidden" ? { ...r, homeSlot: "tile" as const } : r)));
  const grid = shown.filter((r) => r.id !== hero?.id);
  const cta = (r: RoomCard) => R(r.ctaAr, r.ctaEn) || R(DEFAULT_CTA[r.mechanic].ar, DEFAULT_CTA[r.mechanic].en);
  const prompt = (r: RoomCard) => (r.round ? R(r.round.promptAr, r.round.promptEn) : R(r.blurbAr, r.blurbEn));

  return (
    <div className="wc wc-app hm" dir={dirFor(locale)} lang={locale}>
      <PlayHeader locale={locale} balance={balance} />
      <main className="pl-page">
        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="rm-top">
            <span className="hm-kicker" style={{ flex: 1, minWidth: 0 }}>[ {T(page.kicker)} ]</span>
            <span className="rm-reset">
              <small>{u.resets}</small>
              <Countdown initial={secondsToNextRound()} />
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1 className="hm-h1" style={{ fontSize: 30 }}>{T(page.title)}</h1>
            <span className="rm-online">{u.online(rooms.length)}</span>
          </div>
          <p className="hm-sub" style={{ fontSize: 14 }}>{T(page.sub)}</p>
        </section>

        {groups.length ? (
          <nav className="hr-tabs" aria-label={u.all(rooms.length)}>
            <Link href="/rooms" aria-current={!group ? "page" : undefined}>[ {u.all(rooms.length)} ]</Link>
            {groups.map((g) => (
              <Link key={g.key} href={`/rooms?group=${encodeURIComponent(g.key)}`} aria-current={group === g.key ? "page" : undefined}>
                [ {ar ? g.ar : g.en} ]
              </Link>
            ))}
          </nav>
        ) : null}

        {/* Weekly jackpot */}
        <details className="hm-card hm-card-red rm-jackpot">
          <summary>
            <span className="rm-trophy" aria-hidden="true">🏆</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="rm-jp-line">
                <span className="hm-pill hm-pill-red">[ {T(page.jackpot)} ]</span>
                {settings.weeklyPrizePing > 0 ? <b>{u.prize(settings.weeklyPrizePing)}</b> : null}
              </span>
              <span className="rm-jp-score">{u.score(score.correct, score.rank)}</span>
            </span>
            <span className="rm-rules">{u.rules}</span>
          </summary>
          <p className="hm-sub" style={{ padding: "0 14px 14px", fontSize: 13 }}>{T(page.rules)}</p>
        </details>

        {/* Main stage */}
        {hero ? (
          <Link href={`/rooms/${hero.slug}`} className="hm-card hm-hero" style={{ ["--hm-accent" as string]: hero.color }}>
            <div className="hm-img hm-shade" style={{ ["--hm-accent" as string]: hero.color }}>
              {hero.image ? <img src={hero.image} alt="" /> : <span className="hm-emoji" aria-hidden="true">{hero.emoji}</span>}
              {R(hero.tagAr, hero.tagEn) ? <span className="hm-badge rm-tag">[ {R(hero.tagAr, hero.tagEn)} ]</span> : null}
              <span className="hm-badge hm-badge-dark">● {u.live(compact(hero.players, locale))}</span>
            </div>
            <div className="hm-hero-body" style={{ marginTop: -70 }}>
              <div className="hm-row-between">
                <span className="rm-round">{hero.answered ? u.played : u.round(Math.max(hero.roundNo, 1))}</span>
                {hero.config.rewardPing ? <span className="hm-reward">🪙 {u.reward(hero.config.rewardPing)}</span> : null}
              </div>
              <h2 className="hm-title">
                {R(hero.titleAr, hero.titleEn)}: {prompt(hero)}
              </h2>
              <p className="hm-sub" style={{ fontSize: 14 }}>{R(hero.blurbAr, hero.blurbEn)}</p>
              <div className="hm-hero-foot">
                <span className="rm-logged">🔥 {u.logged(compact(hero.players, locale))}</span>
                <span className="hm-btn-red">{cta(hero)} ▸</span>
              </div>
            </div>
          </Link>
        ) : null}

        {/* Arena grid */}
        {grid.length ? (
          <section className="pl-section">
            <div className="hm-sechead">
              <h2 className="rm-section">{T(page.gridTitle)}</h2>
            </div>
            <div className="hm-grid">
              {grid.map((r, i) => {
                const red = i % 4 === 1;
                return (
                  <Link key={r.id} href={`/rooms/${r.slug}`} className={`hm-card hm-tile${red ? " hm-card-red" : ""}`} style={{ ["--hm-accent" as string]: r.color }}>
                    <div className="hm-img" style={{ ["--hm-accent" as string]: r.color }}>
                      {r.image ? <img src={r.image} alt="" loading="lazy" /> : <span className="hm-emoji" aria-hidden="true">{r.emoji}</span>}
                      {R(r.tagAr, r.tagEn) ? <span className={`hm-badge rm-tag${red ? " rm-tag-red" : ""}`}>[ {R(r.tagAr, r.tagEn)} ]</span> : null}
                      <span className="rm-crowd">
                        ● {compact(r.players, locale)} {R(CROWD_WORD[r.mechanic].ar, CROWD_WORD[r.mechanic].en)}
                      </span>
                    </div>
                    <div className="hm-tile-body">
                      <span className="hm-tile-title">{R(r.titleAr, r.titleEn)}</span>
                      <span className="hm-tile-text" style={{ color: "var(--wc-ink)" }}>{prompt(r)}</span>
                      <span className="rm-hint">{r.answered ? u.played : R(r.blurbAr, r.blurbEn)}</span>
                      <span className={red ? "hr-cta hr-cta-red rm-cta" : "hr-cta rm-cta"}>{cta(r)} ▸</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        ) : !hero ? (
          <p className="hm-sub">{u.none}</p>
        ) : null}

        {/* Quick match */}
        {rooms.length ? (
          <Link href="/rooms/random" className="hm-card rm-quick">
            <span className="rm-dot" aria-hidden="true" />
            <span style={{ flex: 1, minWidth: 0 }}>
              <b>{T(page.quickTitle)}</b>
              <small>{T(page.quickText)}</small>
            </span>
            <span className="rm-quick-btn">{T(page.quickCta)}</span>
          </Link>
        ) : null}
      </main>
      <BottomNav locale={locale} current="rooms" />
    </div>
  );
}
