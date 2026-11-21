// watchat.pro home for signed-in viewers: banner carousel, continue watching, explore by genre,
// newest row. Data comes from getHome(); everything links into the existing series and watch pages.

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { BannerCarousel, type Slide } from "./BannerCarousel";
import { BottomNav } from "./BottomNav";
import { ChatIcon, ChevronIcon, GiftIcon, PlayIcon } from "@/components/brand/icons";
import type { HomeSeries, HomeWatching } from "@/lib/content";
import { GENRE_LABELS, GENRES } from "@/lib/content-meta";
import { dirFor, webCopy, type Locale } from "@/lib/web-copy";

type Props = { locale: Locale; balance: number; catalogue: HomeSeries[]; watching: HomeWatching[]; genre: string | null };

const genreLabel = (g: string, locale: Locale) => (GENRE_LABELS as Record<string, { ar: string; en: string }>)[g]?.[locale] ?? g;

function Poster({ s, title }: { s: HomeSeries; title: string }) {
  return (
    <div className="wc-poster">
      {s.posterUrl ? <img src={s.posterUrl} alt="" loading="lazy" /> : <span className="wc-poster-fallback">{title}</span>}
    </div>
  );
}

export function HomeScreen({ locale, balance, catalogue, watching, genre, logo = null }: Props & { logo?: string | null }) {
  const t = webCopy(locale);
  const rtl = locale === "ar";
  const title = (s: { titleAr: string; titleEn: string }) => (locale === "en" ? s.titleEn : s.titleAr);
  const tagline = (s: HomeSeries) => (locale === "en" ? s.taglineEn : s.taglineAr);
  const watchHref = (s: HomeWatching) => (s.resume ? `/watch/${s.code}/${s.resume}` : `/series/${s.code}`);

  const resumeByCode = new Map(watching.map((w) => [w.code, w]));
  const slides: Slide[] = catalogue.slice(0, 5).map((s) => {
    const w = resumeByCode.get(s.code);
    return {
      key: s.code,
      href: w?.resume ? `/watch/${s.code}/${w.resume}` : `/series/${s.code}`,
      title: title(s),
      tagline: tagline(s),
      badge: s.genres[0] ? genreLabel(s.genres[0], locale) : null,
      imageUrl: s.bannerUrl,
      cta: w?.resume ? t.resumeEp(w.resume) : t.watchNow,
    };
  });

  const genresPresent = GENRES.filter((g) => catalogue.some((s) => s.genres.includes(g)));
  const activeGenre = genre && genresPresent.includes(genre as (typeof GENRES)[number]) ? genre : null;
  const explore = activeGenre ? catalogue.filter((s) => s.genres.includes(activeGenre)) : catalogue;
  const continueList = watching.filter((w) => w.resume).slice(0, 3);
  const wordmark = logo ?? (locale === "en" ? "/brand/wordmark-en-dark.png" : "/brand/wordmark-ar-dark.png");

  return (
    <div className="wc" dir={dirFor(locale)} lang={locale}>
      <div style={{ maxWidth: 600, margin: "0 auto", paddingBottom: "calc(110px + env(safe-area-inset-bottom))" }}>
        <header style={{ padding: "18px 16px 8px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <Link href="/" aria-label="Watchat">
            <img src={wordmark} alt="Watchat" style={{ height: 30, width: "auto", display: "block" }} />
          </Link>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Link href="/wallet" className="wc-pill" aria-label={`${t.balance}: ${t.coins(balance)}`}>
              <span className="wc-coin" />
              {balance}
            </Link>
            <Link href="/store" className="wc-round" aria-label={t.getCoins}>
              <GiftIcon color="#ff5a48" />
              <span style={{ position: "absolute", top: 8, insetInlineEnd: 9, width: 9, height: 9, borderRadius: "50%", background: "#ff5a48", border: "2px solid #fff" }} />
            </Link>
          </div>
        </header>

        <main style={{ display: "flex", flexDirection: "column", gap: 26, paddingTop: 10 }}>
          {catalogue.length === 0 ? (
            <p className="wc-card" style={{ margin: "0 16px", padding: 24, textAlign: "center" }}>{t.emptyCatalogue}</p>
          ) : (
            <BannerCarousel slides={slides} label={t.featured} slideLabels={slides.map((_, i) => t.slide(i + 1, slides.length))} />
          )}

          {continueList.length > 0 && (
            <section aria-labelledby="h-continue" style={{ padding: "0 16px", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <h2 id="h-continue" style={{ fontWeight: 600, fontSize: 19 }}>{t.continueWatching}</h2>
                <Link href="/me" className="wc-link" style={{ display: "inline-flex", alignItems: "center", gap: 2, minHeight: 44 }}>
                  {t.seeAll}
                  <ChevronIcon size={16} rtl={rtl} />
                </Link>
              </div>
              {continueList.map((w) => (
                <Link key={w.code} href={watchHref(w)} className="wc-card" style={{ padding: 12, display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ width: 72, flexShrink: 0 }}>
                    <Poster s={w} title={title(w)} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                    <strong style={{ fontWeight: 600, fontSize: 17 }}>{title(w)}</strong>
                    <span style={{ fontSize: 13, color: "var(--wc-muted)" }}>{t.epOf(w.resume as number, w.total)}</span>
                    <div className="wc-progress">
                      <span style={{ width: `${Math.max(4, Math.round((((w.resume as number) - 1) / Math.max(w.total, 1)) * 100))}%` }} />
                    </div>
                  </div>
                  <span aria-hidden="true" style={{ width: 48, height: 48, flexShrink: 0, borderRadius: "50%", background: "var(--wc-mint)", display: "grid", placeItems: "center", boxShadow: "0 8px 18px rgba(49,229,160,.4)" }}>
                    <PlayIcon size={16} fill="#0b2e20" />
                  </span>
                </Link>
              ))}
            </section>
          )}

          {catalogue.length > 0 && (
            <section aria-labelledby="h-newest" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <h2 id="h-newest" style={{ fontWeight: 600, fontSize: 17, padding: "0 16px" }}>{t.newest}</h2>
              <div className="wc-scroller">
                {catalogue.slice(0, 10).map((s, i) => (
                  <Link key={s.code} href={`/series/${s.code}`} style={{ flex: "0 0 116px", display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ position: "relative" }}>
                      <Poster s={s} title={title(s)} />
                      <span aria-hidden="true" style={{ position: "absolute", bottom: 4, insetInlineStart: 10, fontWeight: 700, fontSize: 40, lineHeight: 1, color: "#fff", textShadow: "0 2px 10px rgba(0,0,0,.5)" }}>{i + 1}</span>
                    </div>
                    <span style={{ fontSize: 14, fontWeight: 500 }}>{title(s)}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          <section style={{ padding: "0 16px" }}>
            <Link href="/store" style={{ background: "#ffece8", borderRadius: 22, padding: "14px 16px", display: "flex", alignItems: "center", gap: 14 }}>
              <span aria-hidden="true" style={{ width: 46, height: 46, flexShrink: 0, borderRadius: 14, background: "#ff5a48", display: "grid", placeItems: "center" }}>
                <GiftIcon color="#fff" size={22} />
              </span>
              <span style={{ flex: 1, display: "flex", flexDirection: "column", lineHeight: 1.5 }}>
                <span style={{ fontWeight: 600, fontSize: 16 }}>{t.getCoins}</span>
                <span style={{ fontSize: 13, color: "#6e3a30" }}>
                  {t.balance}: {t.coins(balance)}
                </span>
              </span>
              <ChevronIcon color="#c9341f" rtl={rtl} />
            </Link>
          </section>

          {catalogue.length > 0 && (
            <section aria-labelledby="h-explore" id="explore" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <h2 id="h-explore" style={{ fontWeight: 600, fontSize: 19, padding: "0 16px" }}>{t.explore}</h2>
              {genresPresent.length > 0 && (
                <div className="wc-scroller" style={{ gap: 8 }}>
                  <Link href="/#explore" className="wc-chip" aria-current={activeGenre === null}>
                    {t.allGenres}
                  </Link>
                  {genresPresent.map((g) => (
                    <Link key={g} href={`/?genre=${g}#explore`} className="wc-chip" aria-current={activeGenre === g}>
                      {genreLabel(g, locale)}
                    </Link>
                  ))}
                </div>
              )}
              {explore.length === 0 ? (
                <p style={{ padding: "0 16px", color: "var(--wc-muted)" }}>{t.noMatches}</p>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, padding: "0 16px" }}>
                  {explore.map((s) => (
                    <Link key={s.code} href={`/series/${s.code}`} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <Poster s={s} title={title(s)} />
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{title(s)}</span>
                      <span style={{ fontSize: 12, color: "var(--wc-muted)" }}>{t.episodesCount(s.total)}</span>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          )}
        </main>
      </div>
      {/* The Watchat assistant: find a series, offers, continue watching. */}
      <Link
        href="/assistant"
        aria-label={locale === "en" ? "Watchat assistant" : "مساعد واتشات"}
        style={{
          position: "fixed",
          insetInlineEnd: 16,
          bottom: "calc(96px + env(safe-area-inset-bottom))",
          zIndex: 20,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 16px",
          borderRadius: 999,
          background: "var(--wc-ink)",
          color: "#fff",
          fontWeight: 600,
          fontSize: 15,
          textDecoration: "none",
          boxShadow: "0 12px 28px rgba(18,16,20,0.28)",
        }}
      >
        <ChatIcon color="var(--wc-mint)" size={20} />
        {locale === "en" ? "Ask Watchat" : "اسأل واتشات"}
      </Link>
      <BottomNav locale={locale} current="home" />
    </div>
  );
}
