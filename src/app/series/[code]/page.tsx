// Series page (dark): poster card with status and language, title, genres, Watch / bookmark / share, the story,
// the episode list as chips (Trailer · EP 1 · EP 2 …; the current one in mint, locked ones with a lock, watched
// ones dimmed) and "you might like".

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { notFound } from "next/navigation";
import { PlayIcon, ShareIcon } from "@/components/brand/icons";
import { BookmarkButton } from "@/components/home/BookmarkButton";
import { BottomNav } from "@/components/home/BottomNav";
import { genreLabel, LikeCard, SectionHead } from "@/components/home/SeriesCards";
import { shareHref } from "@/components/ShareButton";
import { TopBar } from "@/components/TopBar";
import { canWatch, compactCount, getEpisodes, getHome, getNextRelease, getSeriesByCode, getSeriesProgress, getUnlocked } from "@/lib/content";
import { getSessionViewer } from "@/lib/session";
import { getBalance } from "@/lib/wallet";
import { dirFor, webCopy } from "@/lib/web-copy";

export const dynamic = "force-dynamic";

export default async function SeriesPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const series = await getSeriesByCode(code);
  if (!series) notFound();

  const viewer = await getSessionViewer();
  const locale = viewer?.uiLocale ?? "ar";
  const t = webCopy(locale);
  const [episodes, nextRelease] = await Promise.all([getEpisodes(series.id), getNextRelease(series.id)]);
  const [unlocked, progress, balance, home] = viewer
    ? await Promise.all([getUnlocked(viewer.id, series.id), getSeriesProgress(viewer.id, series.id), getBalance(viewer.id), getHome(viewer.id)])
    : [{ all: false, episodes: new Set<number>() }, { completed: new Set<number>(), lastStarted: null }, 0, null];

  const resume = progress.lastStarted && progress.completed.has(progress.lastStarted) ? progress.lastStarted + 1 : progress.lastStarted;
  const continueEp = resume && resume <= episodes.length ? resume : null;
  const meta = home?.catalogue.find((s) => s.code === series.code) ?? null;
  // Same genres first, then the rest.
  const shared = (g: string[]) => (meta ? g.filter((x) => meta.genres.includes(x)).length : 0);
  const others = (home?.catalogue ?? [])
    .filter((s) => s.code !== series.code)
    .sort((a, b) => shared(b.genres) - shared(a.genres))
    .slice(0, 6);

  const title = locale === "en" ? series.titleEn : series.titleAr;
  const story = locale === "en" ? series.synopsisEn : series.synopsisAr;
  const art = series.posterUrl ?? series.bannerWideUrl;
  const share = shareHref(series.code, title, locale);
  const status = meta ? (meta.complete ? `${t.epRange(meta.total)} · ${t.complete}` : t.updatingEp(meta.total)) : t.episodesCount(episodes.length);

  return (
    <div className={`wc${viewer ? " wc-app" : ""}`} dir={dirFor(locale)} lang={locale}>
      {viewer ? <TopBar locale={locale} balance={balance} backHref="/" backLabel={t.home} /> : <div style={{ height: 8 }} />}
      <main style={{ maxWidth: 600, margin: "0 auto", padding: "8px 0 24px", display: "flex", flexDirection: "column", gap: 22 }}>
        <div style={{ padding: "0 16px" }}>
          <article className="wc-detail">
            <div className="wc-detail-frame">
              <div className="wc-detail-art" style={{ aspectRatio: "4 / 4.4" }}>
                {art ? <img src={art} alt="" /> : <span className="wc-poster-fallback">{title}</span>}
                <span className="wc-detail-shade" />
              </div>
              <span className="wc-detail-status">
                <span className="wc-dot" aria-hidden="true" />
                {status}
              </span>
              {meta?.rank && meta.rank <= 3 ? <span className="wc-detail-top">{t.topN(meta.rank)}</span> : null}
              <div className="wc-detail-actions">
                <Link className="wc-btn wc-btn-sm" href={`/watch/${series.code}/${continueEp ?? 1}`}>
                  <PlayIcon size={16} />
                  {continueEp ? t.continueEp(continueEp) : t.watchNow}
                </Link>
                {meta && (meta.dub || meta.subs) && <span className="wc-detail-chip">HD · {meta.dub ? t.engDub : t.engSubs}</span>}
              </div>
            </div>
            <div className="wc-detail-body">
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <h1 style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.3, margin: 0 }}>{title}</h1>
                  {meta && meta.genres.length > 0 && <p className="wc-sub">{meta.genres.slice(0, 3).map((g) => genreLabel(g, locale)).join(" · ")}</p>}
                </div>
                {viewer && <BookmarkButton code={series.code} saved={meta?.saved ?? false} labels={{ add: t.saveToList, remove: t.removeFromList }} />}
              </div>
              {story && <p style={{ color: "var(--wc-muted)", fontSize: 15 }}>{story}</p>}
              <div className="wc-detail-meta">
                {meta && meta.views > 0 && (
                  <>
                    <span>
                      <PlayIcon size={13} fill="var(--wc-coral)" /> {compactCount(meta.views, locale)}
                    </span>
                    <span className="wc-sep" aria-hidden="true" />
                  </>
                )}
                <span>{t.episodesCount(meta?.planned ?? episodes.length)}</span>
                {share && (
                  <a href={share} target="_blank" rel="noopener noreferrer" className="wc-detail-share">
                    <ShareIcon size={16} /> {t.share}
                  </a>
                )}
              </div>
            </div>
          </article>
        </div>

        <section aria-labelledby="h-eps" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <SectionHead id="h-eps" title={t.episodeList} />
          <p className="wc-sub" style={{ padding: "0 16px", marginTop: -6 }}>
            {t.episodesCount(episodes.length)}
            {nextRelease
              ? ` · ${t.nextRelease(
                  nextRelease.number,
                  new Date(nextRelease.releaseAt).toLocaleString(locale === "en" ? "en-GB" : "ar-AE", { timeZone: "Asia/Dubai", weekday: "long", hour: "numeric", minute: "2-digit" }),
                )}`
              : ""}
          </p>
          <div className="wc-eps">
            {series.trailerUrl && (
              <a href={series.trailerUrl} target="_blank" rel="noopener noreferrer" className="wc-ep">
                {t.trailer}
              </a>
            )}
            {episodes.map((e) => {
              const open = canWatch(series, e.number, unlocked);
              const done = progress.completed.has(e.number);
              const free = e.number <= series.freeWebUntilEp;
              return (
                <Link
                  key={e.id}
                  href={`/watch/${series.code}/${e.number}`}
                  className="wc-ep"
                  aria-current={e.number === (continueEp ?? 1) ? "true" : undefined}
                  aria-label={`${t.episode(e.number)}${open ? "" : ` · ${t.locked}`}`}
                  style={done && e.number !== continueEp ? { opacity: 0.55 } : undefined}
                >
                  {e.number === (continueEp ?? 1) ? "• " : ""}EP {e.number}
                  {!open ? (
                    <span className="wc-ep-lock" aria-hidden="true">
                      🔒
                    </span>
                  ) : free && !done ? (
                    <span className="wc-ep-free" aria-hidden="true">
                      FREE
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        </section>

        {others.length > 0 && (
          <section aria-labelledby="h-like" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <SectionHead id="h-like" title={t.youMightLike} href="/explore" more={t.seeAll} bar="coral" />
            <div className="wc-grid3">
              {others.map((s) => (
                <LikeCard key={s.code} s={s} locale={locale} />
              ))}
            </div>
          </section>
        )}
      </main>
      {viewer && <BottomNav locale={locale} current={null} />}
    </div>
  );
}
