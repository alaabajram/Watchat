// P6 Series page — continue watching, synopsis, and the episode grid (watched / free / unlocked / locked).

import Link from "next/link";
import { notFound } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { canWatch, getEpisodes, getSeriesByCode, getSeriesProgress, getUnlocked } from "@/lib/content";
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
  const episodes = await getEpisodes(series.id);
  const [unlocked, progress, balance] = viewer
    ? await Promise.all([getUnlocked(viewer.id, series.id), getSeriesProgress(viewer.id, series.id), getBalance(viewer.id)])
    : [{ all: false, episodes: new Set<number>() }, { completed: new Set<number>(), lastStarted: null }, 0];

  const resume =
    progress.lastStarted && progress.completed.has(progress.lastStarted) ? progress.lastStarted + 1 : progress.lastStarted;
  const continueEp = resume && resume <= episodes.length ? resume : null;

  return (
    <main dir={dirFor(locale)}>
      {viewer && <TopBar locale={locale} balance={balance} />}
      <div className="page">
        <h1 style={{ marginTop: 0 }}>{locale === "en" ? series.titleEn : series.titleAr}</h1>
        <p className="muted">{locale === "en" ? series.synopsisEn : series.synopsisAr}</p>
        {continueEp && (
          <Link className="btn" href={`/watch/${series.code}/${continueEp}`} style={{ width: "100%", marginBottom: 16 }}>
            {t.continueEp(continueEp)}
          </Link>
        )}
        <h2>{t.episodes}</h2>
        <div className="grid">
          {episodes.map((e) => {
            const open = canWatch(series, e.number, unlocked);
            const done = progress.completed.has(e.number);
            return (
              <Link
                key={e.id}
                href={`/watch/${series.code}/${e.number}`}
                className={`tile${open ? "" : " locked"}${done ? " done" : ""}${e.number === continueEp ? " current" : ""}`}
                aria-label={`${t.episode(e.number)}${open ? "" : ` · ${t.locked}`}`}
              >
                {open ? e.number : `🔒${e.number}`}
              </Link>
            );
          })}
        </div>
      </div>
    </main>
  );
}
