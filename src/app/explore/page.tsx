// Explore (dark): search, and four views of the catalogue — Explore (everything), New (newest first),
// Categories (by genre) and Ranking (most watched in the last 30 days, numbered). On every view the format row
// filters by kind: micro drama (video) or a story look (visual novel, chat story, motion comic, photo story).

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { redirect } from "next/navigation";
import { SearchIcon } from "@/components/brand/icons";
import { BottomNav } from "@/components/home/BottomNav";
import { ExploreTabs, HomeHeader } from "@/components/home/HomeScreen";
import { genreLabel, LikeCard, seriesTitle, statusLine } from "@/components/home/SeriesCards";
import { compactCount, getHome, type HomeSeries } from "@/lib/content";
import { isSeriesKind, kindLabel, SERIES_KINDS } from "@/lib/catalogue-meta";
import { GENRES } from "@/lib/content-meta";
import { getSessionViewer } from "@/lib/session";
import { DEFAULT_SITE } from "@/lib/site/brand";
import { getSiteSafe } from "@/lib/site/store";
import { getBalance } from "@/lib/wallet";
import { dirFor, webCopy } from "@/lib/web-copy";

export const dynamic = "force-dynamic";

type Tab = "explore" | "new" | "categories" | "ranking";

/** Title, English title, hook or genre contains the search words (any order). */
function matches(s: HomeSeries, q: string, locale: "ar" | "en") {
  const hay = [s.titleAr, s.titleEn, s.taglineAr ?? "", s.taglineEn ?? "", ...s.genres.map((g) => genreLabel(g, locale))].join(" ").toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

export default async function ExplorePage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; genre?: string; format?: string }> }) {
  const viewer = await getSessionViewer();
  if (!viewer) redirect("/");
  const sp = await searchParams;
  const locale = viewer.uiLocale;
  const t = webCopy(locale);
  const tab: Tab = (["new", "categories", "ranking"] as const).find((x) => x === sp.tab) ?? "explore";
  const q = (sp.q ?? "").trim().slice(0, 60);
  const [{ catalogue }, balance, site] = await Promise.all([getHome(viewer.id), getBalance(viewer.id), getSiteSafe()]);
  const logo = site.logoOnDark === DEFAULT_SITE.logoOnDark ? null : site.logoOnDark;

  const genresPresent = GENRES.filter((g) => catalogue.some((s) => s.genres.includes(g)));
  const genre = sp.genre && genresPresent.includes(sp.genre as (typeof GENRES)[number]) ? sp.genre : null;
  const kindsPresent = SERIES_KINDS.filter((k) => catalogue.some((s) => s.kind === k.key));
  const format = isSeriesKind(sp.format) && kindsPresent.some((k) => k.key === sp.format) ? sp.format : null;
  // One link builder so tab, search, genre and format always travel together.
  const href = (o: { genre?: string | null; format?: string | null }) => {
    const qs = new URLSearchParams();
    if (tab !== "explore") qs.set("tab", tab);
    if (q) qs.set("q", q);
    const g = o.genre === undefined ? genre : o.genre;
    const f = o.format === undefined ? format : o.format;
    if (g) qs.set("genre", g);
    if (f) qs.set("format", f);
    const str = qs.toString();
    return `/explore${str ? `?${str}` : ""}`;
  };
  let list = q ? catalogue.filter((s) => matches(s, q, locale)) : catalogue;
  if (format) list = list.filter((s) => s.kind === format);
  if (genre) list = list.filter((s) => s.genres.includes(genre));
  if (tab === "new") list = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (tab === "ranking") list = [...list].sort((a, b) => b.views - a.views || b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="wc" dir={dirFor(locale)} lang={locale}>
      <div style={{ maxWidth: 600, margin: "0 auto", paddingBottom: "calc(120px + env(safe-area-inset-bottom))" }}>
        <HomeHeader locale={locale} balance={balance} logo={logo} />
        <ExploreTabs locale={locale} current={tab} />
        <main style={{ display: "flex", flexDirection: "column", gap: 18, paddingTop: 16 }}>
          <form id="search" action="/explore" method="get" className="wc-search" role="search">
            <SearchIcon />
            {tab !== "explore" && <input type="hidden" name="tab" value={tab} />}
            {format && <input type="hidden" name="format" value={format} />}
            {genre && <input type="hidden" name="genre" value={genre} />}
            <input name="q" defaultValue={q} placeholder={t.searchSeries} aria-label={t.searchSeries} enterKeyHint="search" />
          </form>

          {kindsPresent.length > 1 && (
            <nav className="wc-scroller wc-kinds" style={{ gap: 8 }} aria-label={t.formats}>
              <Link href={href({ format: null })} className="wc-chip wc-kind" aria-current={format === null}>
                {t.allFormats}
              </Link>
              {kindsPresent.map((k) => (
                <Link key={k.key} href={href({ format: k.key })} className="wc-chip wc-kind" aria-current={format === k.key}>
                  {kindLabel(k.key, locale)}
                </Link>
              ))}
            </nav>
          )}

          {(tab === "categories" || genre) && genresPresent.length > 0 && (
            <div className="wc-scroller" style={{ gap: 8 }}>
              <Link href={href({ genre: null })} className="wc-chip" aria-current={genre === null}>
                {t.allGenres}
              </Link>
              {genresPresent.map((g) => (
                <Link key={g} href={href({ genre: g })} className="wc-chip" aria-current={genre === g}>
                  {genreLabel(g, locale)}
                </Link>
              ))}
            </div>
          )}

          {list.length === 0 ? (
            <p className="wc-sub" style={{ padding: "0 16px" }}>
              {t.noMatches}
            </p>
          ) : tab === "ranking" ? (
            <ol style={{ listStyle: "none", margin: 0, padding: "0 16px", display: "flex", flexDirection: "column", gap: 10 }}>
              {list.map((s, i) => (
                <li key={s.code}>
                  <Link href={`/series/${s.code}`} className="wc-card" style={{ display: "flex", alignItems: "center", gap: 14, padding: 10 }}>
                    <span style={{ width: 34, textAlign: "center", fontSize: 26, fontWeight: 800, color: i < 3 ? "var(--wc-coral)" : "var(--wc-muted)" }}>{i + 1}</span>
                    <div style={{ width: 64, flexShrink: 0 }}>
                      <div className="wc-poster">{s.posterUrl ? <img src={s.posterUrl} alt="" loading="lazy" /> : <span className="wc-poster-fallback">{seriesTitle(s, locale)}</span>}</div>
                    </div>
                    <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                      <strong className="wc-clamp1" style={{ fontSize: 16 }}>
                        {seriesTitle(s, locale)}
                      </strong>
                      <span className="wc-sub wc-clamp1">{[kindLabel(s.kind, locale), ...s.genres.slice(0, 2).map((g) => genreLabel(g, locale))].join(" · ")}</span>
                      <span className="wc-sub">
                        {s.views > 0 ? `▶ ${compactCount(s.views, locale)} · ` : ""}
                        {statusLine(s, locale)}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ol>
          ) : (
            <div className="wc-grid3">
              {list.map((s) => (
                <LikeCard key={s.code} s={s} locale={locale} tag={s.rank === 1 ? { text: t.topN(1), tone: "mint" } : null} />
              ))}
            </div>
          )}
        </main>
      </div>
      <BottomNav locale={locale} current="explore" />
    </div>
  );
}
