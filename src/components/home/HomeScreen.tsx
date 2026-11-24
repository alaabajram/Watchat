// watchat.pro home for signed-in viewers (dark): header with search and Ping, Explore / New / Categories / Ranking
// tabs, the featured hero cards, continue watching, trending micro-series and "you might like".
// Data comes from getHome(); everything links into the series, explore and watch pages.

/* eslint-disable @next/next/no-img-element */
import { kindLabel } from "@/lib/catalogue-meta";
import Link from "next/link";
import { BannerCarousel, type Slide } from "./BannerCarousel";
import { BottomNav } from "./BottomNav";
import { genreLabel, LikeCard, SectionHead, seriesTitle, TrendCard } from "./SeriesCards";
import { GiftIcon, PlayIcon, SearchIcon } from "@/components/brand/icons";
import { PingIcon } from "@/components/brand/PingIcon";
import { shareHref } from "@/components/ShareButton";
import { compactCount, type HomeSeries, type HomeWatching } from "@/lib/content";
import { dirFor, webCopy, type Locale } from "@/lib/web-copy";

type Props = { locale: Locale; balance: number; catalogue: HomeSeries[]; watching: HomeWatching[]; genre: string | null };

/** The tabs under the header (also on Explore). */
export function ExploreTabs({ locale, current }: { locale: Locale; current: "explore" | "new" | "categories" | "ranking" | null }) {
  const t = webCopy(locale);
  const tabs = [
    { key: "explore", href: "/explore", label: t.explore },
    { key: "new", href: "/explore?tab=new", label: t.tabNew },
    { key: "categories", href: "/explore?tab=categories", label: t.tabCategories },
    { key: "ranking", href: "/explore?tab=ranking", label: t.tabRanking },
  ] as const;
  return (
    <nav className="wc-tabs" aria-label={t.explore}>
      {tabs.map((tab) => (
        <Link key={tab.key} href={tab.href} aria-current={current === tab.key ? "page" : undefined}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

/** Logo · search · Ping balance · get Ping. */
export function HomeHeader({ locale, balance, logo }: { locale: Locale; balance: number; logo: string | null }) {
  const t = webCopy(locale);
  const wordmark = logo ?? (locale === "en" ? "/brand/wordmark-en-white.png" : "/brand/wordmark-ar-white.png");
  return (
    <header className="wc-homehead">
      <Link href="/" aria-label="Watchat">
        <img src={wordmark} alt="Watchat" style={{ height: 30, width: "auto", display: "block" }} />
      </Link>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Link href="/explore#search" className="wc-round" aria-label={t.searchSeries}>
          <SearchIcon />
        </Link>
        <Link href="/wallet" className="wc-pill" aria-label={`${t.balance}: ${t.coins(balance)}`}>
          <PingIcon size={20} />
          {balance}
        </Link>
        <Link href="/store" className="wc-round" aria-label={t.getCoins}>
          <GiftIcon color="#ff5a48" />
          <span className="wc-dotbadge" aria-hidden="true" />
        </Link>
      </div>
    </header>
  );
}

export function HomeScreen({ locale, balance, catalogue, watching, logo = null }: Props & { logo?: string | null }) {
  const t = webCopy(locale);
  const title = (s: { titleAr: string; titleEn: string }) => seriesTitle(s, locale);
  const watchHref = (s: HomeWatching) => (s.resume ? `/watch/${s.code}/${s.resume}` : `/series/${s.code}`);
  const resumeByCode = new Map(watching.map((w) => [w.code, w]));

  // Hero: the most watched first, then the newest.
  const byViews = [...catalogue].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || b.createdAt.localeCompare(a.createdAt));
  const slides: Slide[] = byViews.slice(0, 5).map((s) => {
    const w = resumeByCode.get(s.code);
    const share = shareHref(s.code, title(s), locale);
    return {
      key: s.code,
      href: w?.resume ? `/watch/${s.code}/${w.resume}` : `/watch/${s.code}/1`,
      title: title(s),
      imageUrl: s.posterUrl ?? s.bannerUrl,
      cta: w?.resume ? t.resumeEp(w.resume) : t.watchNow,
      status: s.complete ? `${t.epRange(s.total)} · ${t.complete}` : t.updatingEp(s.total),
      top: s.rank !== null && s.rank <= 3 ? t.topN(s.rank) : null,
      // Story series have no video quality or dub: the chip says what kind of story it is.
      chip: s.kind === "micro_drama" ? ["HD", s.dub ? t.engDub : s.subs ? t.engSubs : null].filter(Boolean).join(" · ") : kindLabel(s.kind, locale),
      genres: s.genres.slice(0, 3).map((g) => genreLabel(g, locale)).join(" · "),
      views: s.views > 0 ? compactCount(s.views, locale) : null,
      episodes: t.episodesCount(s.planned),
      share: share ? { href: share, label: t.share } : null,
      bookmark: { code: s.code, saved: s.saved, labels: { add: t.saveToList, remove: t.removeFromList } },
    };
  });
  const heroCodes = new Set(slides.map((s) => s.key));
  const trending = [...catalogue].filter((s) => s.views > 0).sort((a, b) => b.views - a.views).slice(0, 10);
  const trendRow = trending.length >= 3 ? trending : [...catalogue].slice(0, 10);
  const likes = catalogue.filter((s) => !heroCodes.has(s.code) || catalogue.length <= 6).slice(0, 12);
  const continueList = watching.filter((w) => w.resume).slice(0, 3);
  const tagFor = (s: HomeSeries) =>
    s.rank === 1 ? { text: t.topN(1), tone: "mint" as const } : Date.now() - Date.parse(s.createdAt) < 14 * 86400_000 ? { text: t.tabNew, tone: "coral" as const } : null;

  return (
    <div className="wc" dir={dirFor(locale)} lang={locale}>
      <div style={{ maxWidth: 600, margin: "0 auto", paddingBottom: "calc(120px + env(safe-area-inset-bottom))" }}>
        <HomeHeader locale={locale} balance={balance} logo={logo} />
        <ExploreTabs locale={locale} current={null} />

        <main style={{ display: "flex", flexDirection: "column", gap: 28, paddingTop: 14 }}>
          {catalogue.length === 0 ? (
            <p className="wc-card" style={{ margin: "0 16px", padding: 24, textAlign: "center" }}>
              {t.emptyCatalogue}
            </p>
          ) : (
            <BannerCarousel slides={slides} label={t.featured} slideLabels={slides.map((_, i) => t.slide(i + 1, slides.length))} />
          )}

          {continueList.length > 0 && (
            <section aria-labelledby="h-continue" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <SectionHead id="h-continue" title={t.continueWatching} href="/list" more={t.seeAll} />
              <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "0 16px" }}>
                {continueList.map((w) => (
                  <Link key={w.code} href={watchHref(w)} className="wc-card" style={{ padding: 12, display: "flex", alignItems: "center", gap: 14 }}>
                    <div style={{ width: 64, flexShrink: 0 }}>
                      <div className="wc-poster">{w.posterUrl ? <img src={w.posterUrl} alt="" loading="lazy" /> : <span className="wc-poster-fallback">{title(w)}</span>}</div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                      <strong className="wc-clamp1" style={{ fontWeight: 600, fontSize: 16 }}>
                        {title(w)}
                      </strong>
                      <span className="wc-sub">{t.epOf(w.resume as number, w.total)}</span>
                      <div className="wc-progress">
                        <span style={{ width: `${Math.max(4, Math.round((((w.resume as number) - 1) / Math.max(w.total, 1)) * 100))}%` }} />
                      </div>
                    </div>
                    <span aria-hidden="true" className="wc-playdot">
                      <PlayIcon size={16} fill="#0b2e20" />
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {trendRow.length > 0 && (
            <section aria-labelledby="h-trending" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <SectionHead id="h-trending" title={t.trending} hot={t.hot} href="/explore?tab=ranking" more={t.seeAll} bar="coral" />
              <div className="wc-scroller">
                {trendRow.map((s) => (
                  <TrendCard key={s.code} s={s} locale={locale} />
                ))}
              </div>
            </section>
          )}

          {likes.length > 0 && (
            <section aria-labelledby="h-like" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <SectionHead id="h-like" title={t.youMightLike} href="/explore" more={t.seeAll} bar="coral" />
              <div className="wc-grid3">
                {likes.map((s) => (
                  <LikeCard key={s.code} s={s} locale={locale} tag={tagFor(s)} />
                ))}
              </div>
            </section>
          )}

        </main>
      </div>
      <BottomNav locale={locale} current="home" />
    </div>
  );
}
