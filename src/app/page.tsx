// watchat.pro — one address, two doors:
// • no session on this browser → splash with the animated logo and every way in (Telegram, phone number, email,
//   and WhatsApp while it's sending; `SignInDoors`);
// • a session → the Playground home in the neon "carnival" look: streak banner, headline, the hero room, your day
//   (card + horoscope), room tiles and wide room cards, AI People, Discover tiles. Every text and picture comes
//   from Admin → Home page / Rooms / AI People (`home_content`, `rooms`, `ai_people`).

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { SignedOut } from "@/components/play/PlayShell";
import { BottomNav } from "@/components/home/BottomNav";
import { HomeScreenTip } from "@/components/HomeScreenTip";
import { PingIcon } from "@/components/brand/PingIcon";
import { SIGNS } from "@/lib/daily/daily";
import { cardById, cardMeaning } from "@/lib/daily/tarot";
import { compact, homeLayout, type L } from "@/lib/play/home";
import { activeToday, ensureStarter, homeContent, liveRooms, livePeople, playImage, todayFor, touchHabit, type RoomCard } from "@/lib/play/store";
import { AI_LABEL } from "@/lib/people/persona";
import { getSessionViewer } from "@/lib/session";
import { DEFAULT_SITE } from "@/lib/site/brand";
import { getSiteSafe } from "@/lib/site/store";
import { currentTenantId } from "@/lib/supabase";
import { getBalance } from "@/lib/wallet";
import { dirFor } from "@/lib/web-copy";

export const dynamic = "force-dynamic";

const UI = {
  ar: {
    live: "مباشر",
    day: (n: number) => (n <= 1 ? "اليوم ١ — سلسلتك بدأت" : `اليوم ${n} — سلسلتك شغّالة`),
    toUnlock: (left: number) => (left === 1 ? "باقي يوم على" : `باقي ${left} أيام على`),
    bonus: "مكافأة",
    earned: (p: number) => `مبروك! +${p} بينج اليوم`,
    claim: "استلم",
    online: (n: string) => `${n} يلعبون اليوم`,
    arena: "مباشر الحين",
    playing: (n: string) => `${n} يلعبون`,
    roundToday: "جولة اليوم",
    voting: "التصويت مفتوح",
    answered: "جاوبت ✓",
    playNow: "العب الحين",
    seeAll: "الكل",
    explore: "استكشف",
    card: "بطاقة اليوم",
    tapReveal: "اكشف بطاقتك وكلمتك لليوم",
    reveal: "اكشف حظك",
    horoscope: "الأبراج",
    pickSign: "اختر برجك",
    pickHint: "مرة وحدة، وكل يوم يجيك كلامه",
    readChart: "اقرأ البرج",
    votes: (n: string) => `${n} صوت`,
    play: "العب",
    join: "ادخل",
    open: "افتح",
    pings: (n: number) => `+${n} بينج`,
    heroes: (n: number) => `${n} شخصية`,
    chat: "سولف",
  },
  en: {
    live: "Live",
    day: (n: number) => `Day ${Math.max(n, 1)} — daily streak active`,
    toUnlock: (left: number) => `${left} more ${left === 1 ? "day" : "days"} to unlock`,
    bonus: "bonus",
    earned: (p: number) => `Streak bonus unlocked: +${p} Ping today`,
    claim: "Claim",
    online: (n: string) => `${n} playing today`,
    arena: "Live arena",
    playing: (n: string) => `${n} playing`,
    roundToday: "Today's round",
    voting: "Voting open",
    answered: "You answered ✓",
    playNow: "Play now",
    seeAll: "See all",
    explore: "Explore",
    card: "Card of the day",
    tapReveal: "Reveal your card and your word for today",
    reveal: "Reveal fate",
    horoscope: "Horoscope",
    pickSign: "Pick your sign",
    pickHint: "Just once — then a new reading daily",
    readChart: "Read chart",
    votes: (n: string) => `${n} votes`,
    play: "Play",
    join: "Join",
    open: "Inspect",
    pings: (n: number) => `+${n} Ping`,
    heroes: (n: number) => `${n} heroes`,
    chat: "Chat",
  },
};

function Art({ src, emoji, accent, children, className = "" }: { src: string | null; emoji: string; accent: string; children?: React.ReactNode; className?: string }) {
  return (
    <div className={`hm-img ${className}`} style={{ ["--hm-accent" as string]: accent }}>
      {src ? <img src={src} alt="" loading="lazy" /> : <span className="hm-emoji" aria-hidden="true">{emoji}</span>}
      {children}
    </div>
  );
}

export default async function Home({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const params = await searchParams;
  const viewer = await getSessionViewer();
  if (!viewer) return <SignedOut path="/" lang={params.lang} />;

  const tenantId = await currentTenantId();
  await Promise.all([ensureStarter(tenantId), touchHabit(viewer.id)]);
  const locale = viewer.uiLocale;
  const ar = locale === "ar";
  const u = UI[locale];
  const T = (x: L) => (ar ? x.ar || x.en : x.en || x.ar);
  const [balance, site, today, rooms, people, content, online] = await Promise.all([
    getBalance(viewer.id),
    getSiteSafe(),
    todayFor(tenantId, viewer.id),
    liveRooms(tenantId, viewer.id),
    livePeople(tenantId),
    homeContent(tenantId),
    activeToday(tenantId),
  ]);
  const logo = site.logoOnDark !== DEFAULT_SITE.logoOnDark ? site.logoOnDark : `/brand/wordmark-${ar ? "ar" : "en"}-white.png`;
  const card = cardById(today.card.card);
  const sign = today.sign ? SIGNS.find((s) => s.key === today.sign) : null;
  const { hero, tiles, wide } = homeLayout(rooms);
  const R = (r: RoomCard, a: string, e: string) => (ar ? a || e : e || a);
  const roomText = (r: RoomCard) => (r.round ? R(r, r.round.promptAr, r.round.promptEn) : R(r, r.blurbAr, r.blurbEn));
  const cardImg = playImage(content.day.cardImage);
  const signImg = playImage(content.day.horoscopeImage);

  return (
    <div className="wc wc-app hm" dir={dirFor(locale)} lang={locale}>
      <header className="hm-head">
        <Link href="/" className="hm-brand" aria-label="Watchat">
          <img src={logo} alt="Watchat" style={{ height: 26, width: "auto", display: "block" }} />
          <span className="hm-live">{u.live}</span>
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Link href="/wallet" className="hm-ping" aria-label={`Ping: ${balance}`}>
            <PingIcon size={18} />
            {balance}
          </Link>
          <Link href="/today#alerts" className="hm-bell" aria-label={ar ? "التنبيهات" : "Alerts"}>
            🔔
          </Link>
        </div>
      </header>

      <main className="pl-page">
        {/* Streak banner */}
        <section className="hm-streak" aria-label={u.day(today.streak)}>
          <span className="hm-streak-icon" aria-hidden="true">🔥</span>
          <div style={{ minWidth: 0 }}>
            <b>{u.day(today.streak)}</b>
            <small>
              {today.streakPing ? (
                u.earned(today.streakPing)
              ) : today.next ? (
                <>
                  {u.toUnlock(today.next.left)} <em>+{today.next.ping} Ping</em> {u.bonus}
                </>
              ) : null}
            </small>
          </div>
          <Link href="/rewards" className="hm-btn-red">
            {u.claim}
          </Link>
        </section>

        {/* Headline */}
        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="hm-kicker">
            {T(content.kicker)} • {u.online(compact(online, locale))}
          </span>
          <h1 className="hm-h1">
            {T(content.headline)} <span>{T(content.highlight)}</span>
          </h1>
        </section>

        {/* Hero room */}
        {hero ? (
          <Link href={`/rooms/${hero.slug}`} className="hm-card hm-hero" style={{ ["--hm-accent" as string]: hero.color }}>
            <Art src={hero.image} emoji={hero.emoji} accent={hero.color} className="hm-shade">
              <span className="hm-badge">● {u.arena}</span>
              <span className="hm-badge hm-badge-dark">👁 {u.playing(compact(hero.players, locale))}</span>
            </Art>
            <div className="hm-hero-body">
              <div className="hm-tagline">
                <span className="hm-pill">{R(hero, hero.tagAr, hero.tagEn) || R(hero, hero.titleAr, hero.titleEn)}</span>
                <span style={{ color: "var(--hm-green)" }}>{u.roundToday}</span>
              </div>
              <h2 className="hm-title">{roomText(hero)}</h2>
              <div className="hm-hero-foot">
                <div className="hm-crowd">
                  <span className="hm-dots" aria-hidden="true">
                    <span>{hero.emoji}</span>
                    <span className="hm-count">+{compact(hero.players, locale)}</span>
                  </span>
                  <span>
                    <b>{R(hero, hero.titleAr, hero.titleEn)}</b>
                    <small>{hero.answered ? u.answered : u.voting}</small>
                  </span>
                </div>
                <span className="hm-btn-green">{u.playNow} ▸</span>
              </div>
            </div>
          </Link>
        ) : null}

        {/* Your day */}
        <section className="pl-section" aria-label={T(content.day.title)}>
          <div className="hm-sechead">
            <div>
              <h2 className="hm-h2">{T(content.day.title)} <span style={{ color: "var(--hm-red)" }}>✦</span></h2>
              <p className="hm-sub">{T(content.day.sub)}</p>
            </div>
            <Link href="/today" className="hm-more">{u.seeAll} ▸</Link>
          </div>
          <div className="hm-grid">
            <Link href="/today" className="hm-card hm-card-red hm-tile" style={{ ["--hm-accent" as string]: "#f5c242" }}>
              <Art src={cardImg} emoji={today.card.drawn ? card.emoji : "🔮"} accent="#f5c242">
                <span className="hm-badge hm-badge-dark">{today.card.drawn ? (ar ? card.wordAr : card.wordEn) : "?"}</span>
              </Art>
              <div className="hm-tile-body">
                <span className="hm-tile-kicker">{u.card}</span>
                <span className="hm-tile-title">{today.card.drawn ? (ar ? card.nameAr : card.nameEn) : "???"}</span>
                <span className="hm-tile-text">{today.card.drawn ? cardMeaning(card, today.card.reversed, locale) : u.tapReveal}</span>
                <span className="hm-btn-line">{u.reveal} ▸</span>
              </div>
            </Link>
            <Link href={sign ? "/horoscope" : "/today"} className="hm-card hm-tile" style={{ ["--hm-accent" as string]: "#7c5cff" }}>
              <Art src={signImg} emoji={sign ? sign.symbol : "✨"} accent="#7c5cff">
                {today.horoscope?.luckyNumber ? <span className="hm-badge hm-badge-dark">#{today.horoscope.luckyNumber}</span> : null}
              </Art>
              <div className="hm-tile-body">
                <span className="hm-tile-kicker" style={{ color: "#c4b5ff" }}>{u.horoscope}</span>
                <span className="hm-tile-title">{sign ? (ar ? sign.ar : sign.en) : u.pickSign}</span>
                <span className="hm-tile-text">{sign && today.horoscope ? (ar ? today.horoscope.ar : today.horoscope.en) : u.pickHint}</span>
                <span className="hm-btn-line">{u.readChart} ▸</span>
              </div>
            </Link>
          </div>
        </section>

        {/* Rooms */}
        {tiles.length || wide.length ? (
          <section className="pl-section" aria-label={T(content.rooms.title)}>
            <div className="hm-sechead">
              <div>
                <h2 className="hm-h2">
                  {T(content.rooms.title)} <span className="hm-pill">{T(content.rooms.badge)}</span>
                </h2>
                <p className="hm-sub">{T(content.rooms.sub)}</p>
              </div>
              <Link href="/rooms" className="hm-more">{u.explore} ▸</Link>
            </div>
            {tiles.length ? (
              <div className="hm-grid">
                {tiles.map((r, i) => (
                  <Link key={r.id} href={`/rooms/${r.slug}`} className={`hm-card hm-tile${i % 2 ? " hm-card-red" : ""}`} style={{ ["--hm-accent" as string]: r.color }}>
                    <Art src={r.image} emoji={r.emoji} accent={r.color}>
                      <span className="hm-badge">{compact(r.players, locale)} ●</span>
                    </Art>
                    <div className="hm-tile-body">
                      <span className="hm-tile-kicker">{R(r, r.tagAr, r.tagEn) || (r.answered ? u.answered : u.roundToday)}</span>
                      <span className="hm-tile-title">{R(r, r.titleAr, r.titleEn)}</span>
                      <span className="hm-tile-text">{roomText(r)}</span>
                      <span className="hm-tile-foot">
                        <span>{u.votes(compact(r.players, locale))}</span>
                        <span className="hm-btn-green">{i % 2 ? u.join : u.play} ▸</span>
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            ) : null}
            {wide.map((r) => (
              <Link key={r.id} href={`/rooms/${r.slug}`} className="hm-card hm-wide" style={{ ["--hm-accent" as string]: r.color }}>
                <Art src={r.image} emoji={r.emoji} accent={r.color} className="hm-shade">
                  {R(r, r.tagAr, r.tagEn) ? <span className="hm-badge" style={{ background: "#f5c242", color: "#2a1a00" }}>{R(r, r.tagAr, r.tagEn)}</span> : null}
                </Art>
                <div className="hm-wide-body">
                  <div className="hm-tagline">
                    <span className="hm-pill">{R(r, r.titleAr, r.titleEn)}</span>
                    <span style={{ color: "var(--wc-muted)", marginInlineStart: "auto" }}>● {u.playing(compact(r.players, locale))}</span>
                  </div>
                  <h3 className="hm-title" style={{ fontSize: 19 }}>{roomText(r)}</h3>
                  <p className="hm-sub">{R(r, r.blurbAr, r.blurbEn)}</p>
                  <div className="hm-hero-foot">
                    {r.config.rewardPing ? <span className="hm-reward">🪙 {u.pings(r.config.rewardPing)}</span> : <span />}
                    <span className="hm-btn-green">{u.open} ▸</span>
                  </div>
                </div>
              </Link>
            ))}
          </section>
        ) : null}

        {/* AI People */}
        {people.length ? (
          <section className="pl-section" aria-label={T(content.people.title)}>
            <div className="hm-sechead">
              <div>
                <h2 className="hm-h2">{T(content.people.title)}</h2>
                <p className="hm-sub">{T(content.people.sub)}</p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                <span className="hm-pill hm-pill-red">{T(content.people.badge)}</span>
                <Link href="/people" className="hm-more">{u.heroes(people.length)}</Link>
              </div>
            </div>
            <div className="hm-rail">
              {people.map((p, i) => (
                <Link key={p.id} href={`/people/${p.slug}`} className={`hm-card hm-person${i % 2 ? " hm-card-red" : ""}`} style={{ ["--hm-accent" as string]: p.color }}>
                  <span className="hm-portrait">
                    {p.image ? <img src={p.image} alt="" loading="lazy" /> : <span aria-hidden="true">{p.emoji}</span>}
                  </span>
                  <span className="hm-person-name">{ar ? p.nameAr : p.nameEn}</span>
                  {(ar ? p.tagAr : p.tagEn) ? <span className="hm-pill">{ar ? p.tagAr : p.tagEn}</span> : null}
                  <span className="hm-person-role">{ar ? p.roleAr : p.roleEn}</span>
                  <span className="hm-ai">{AI_LABEL[locale]}</span>
                  <span className="hm-btn-line" style={{ width: "100%", justifyContent: "center" }}>{u.chat}</span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {/* Discover */}
        {content.discover.tiles.length ? (
          <section className="pl-section" aria-label={T(content.discover.title)}>
            <div className="hm-sechead">
              <h2 className="hm-h2">{T(content.discover.title)}</h2>
              <Link href="/discover" className="hm-more">{u.seeAll} ▸</Link>
            </div>
            {content.discover.tiles.map((tile, i) => {
              const img = playImage(tile.image);
              return (
                <Link key={i} href={tile.href} className={`hm-card hm-disc${i % 2 ? " hm-card-red" : ""}`} style={{ ["--hm-accent" as string]: tile.color }}>
                  <div className="hm-disc-body">
                    {T(tile.kicker) ? <span className="hm-pill" style={{ color: tile.color, borderColor: tile.color }}>{T(tile.kicker)}</span> : null}
                    <span className="hm-title" style={{ fontSize: 18 }}>{T(tile.title)}</span>
                    {T(tile.text) ? <span className="hm-sub">{T(tile.text)}</span> : null}
                    <span className={i % 2 ? "hm-btn-red" : "hm-btn-green"} style={{ marginInlineStart: 0 }}>{T(tile.cta)} ▸</span>
                  </div>
                  <span className="hm-disc-img">{img ? <img src={img} alt="" loading="lazy" /> : <span aria-hidden="true">{i % 2 ? "🎡" : "🎬"}</span>}</span>
                </Link>
              );
            })}
          </section>
        ) : null}
        <HomeScreenTip locale={locale} />
      </main>
      <BottomNav locale={locale} current="home" />
    </div>
  );
}
