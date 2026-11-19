// P6 Series page — synopsis and the episode grid with free / unlocked / locked states.

import Link from "next/link";
import { notFound } from "next/navigation";
import { canWatch, getEpisodes, getSeriesByCode, getUnlocked } from "@/lib/content";
import { getSessionViewer } from "@/lib/session";
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
  const unlocked = viewer ? await getUnlocked(viewer.id, series.id) : { all: false, episodes: new Set<number>() };

  return (
    <main className="page" dir={dirFor(locale)}>
      <h1 style={{ marginTop: 0 }}>{locale === "en" ? series.titleEn : series.titleAr}</h1>
      <p className="muted">{locale === "en" ? series.synopsisEn : series.synopsisAr}</p>
      <h2>{t.episodes}</h2>
      <div className="grid">
        {episodes.map((e) => {
          const open = canWatch(series, e.number, unlocked);
          return (
            <Link
              key={e.id}
              href={`/watch/${series.code}/${e.number}`}
              className={`tile${open ? "" : " locked"}`}
              aria-label={`${t.episode(e.number)}${open ? "" : ` · ${t.locked}`}`}
            >
              {e.number}
            </Link>
          );
        })}
      </div>
    </main>
  );
}
