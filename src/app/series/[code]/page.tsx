// P6 Series page — continue watching, synopsis, and the episode grid (watched / free / unlocked / locked).

import Link from "next/link";
import { notFound } from "next/navigation";
import { PlayIcon } from "@/components/brand/icons";
import { BottomNav } from "@/components/home/BottomNav";
import { TopBar } from "@/components/TopBar";
import { canWatch, getEpisodes, getNextRelease, getSeriesByCode, getSeriesProgress, getUnlocked } from "@/lib/content";
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
  const [unlocked, progress, balance] = viewer
    ? await Promise.all([getUnlocked(viewer.id, series.id), getSeriesProgress(viewer.id, series.id), getBalance(viewer.id)])
    : [{ all: false, episodes: new Set<number>() }, { completed: new Set<number>(), lastStarted: null }, 0];

  const resume =
    progress.lastStarted && progress.completed.has(progress.lastStarted) ? progress.lastStarted + 1 : progress.lastStarted;
  const continueEp = resume && resume <= episodes.length ? resume : null;

  const title = locale === "en" ? series.titleEn : series.titleAr;
  const art = series.bannerWideUrl ?? series.posterUrl;
  return (
    <div className={`wc${viewer ? " wc-app" : ""}`} dir={dirFor(locale)} lang={locale}>
      {viewer ? <TopBar locale={locale} balance={balance} backHref="/" backLabel={t.home} /> : <div style={{ height: 8 }} />}
      <main style={{ maxWidth: 600, margin: "0 auto", padding: "8px 16px 24px", display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ position: "relative", borderRadius: 28, overflow: "hidden", background: "var(--wc-night)", aspectRatio: "16 / 10" }}>
          {art && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={art} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
          )}
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(19,16,26,0.9), rgba(19,16,26,0.1) 60%)" }} />
          <h1 style={{ position: "absolute", insetInline: 18, bottom: 16, color: "#fff", fontSize: 26, fontWeight: 700 }}>{title}</h1>
        </div>
        {(locale === "en" ? series.synopsisEn : series.synopsisAr) && (
          <p style={{ color: "var(--wc-muted)", fontSize: 16 }}>{locale === "en" ? series.synopsisEn : series.synopsisAr}</p>
        )}
        <Link className="wc-btn" href={`/watch/${series.code}/${continueEp ?? 1}`} style={{ width: "100%" }}>
          <PlayIcon />
          {continueEp ? t.continueEp(continueEp) : t.watchNow}
        </Link>
        <section aria-labelledby="h-eps" className="wc-card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
            <h2 id="h-eps" className="wc-section-title">{t.episodes}</h2>
            <span style={{ fontSize: 13, color: "var(--wc-muted)" }}>{t.episodesCount(episodes.length)}</span>
          </div>
          {nextRelease && (
            <p style={{ fontSize: 14, color: "var(--wc-muted)" }}>
              {t.nextRelease(
                nextRelease.number,
                new Date(nextRelease.releaseAt).toLocaleString(locale === "en" ? "en-GB" : "ar-AE", { timeZone: "Asia/Dubai", weekday: "long", hour: "numeric", minute: "2-digit" }),
              )}
            </p>
          )}
          <div className="grid">
            {episodes.map((e) => {
              const open = canWatch(series, e.number, unlocked);
              const done = progress.completed.has(e.number);
              return (
                <Link
                  key={e.id}
                  href={`/watch/${series.code}/${e.number}`}
                  className={`tile${open ? "" : " locked"}${done ? " done" : ""}${e.number === continueEp ? " current" : ""}`}
                  style={{ background: open && !done ? "var(--wc-bg)" : undefined, boxShadow: "none" }}
                  aria-label={`${t.episode(e.number)}${open ? "" : ` · ${t.locked}`}`}
                >
                  {open ? (
                    e.number
                  ) : (
                    <span style={{ display: "flex", alignItems: "center", gap: 2 }}>
                      <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}><path d="M6 11V8a6 6 0 0 1 12 0v3M5 11h14v10H5z" /></svg>
                      {e.number}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </section>
      </main>
      {viewer && <BottomNav locale={locale} current={null} />}
    </div>
  );
}
