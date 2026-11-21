// My List — the viewer's series (continue watching, finished) and the rest of the catalogue.

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { redirect } from "next/navigation";
import { PlayIcon } from "@/components/brand/icons";
import { BottomNav } from "@/components/home/BottomNav";
import { TopBar } from "@/components/TopBar";
import { getLibrary } from "@/lib/content";
import { getSessionViewer } from "@/lib/session";
import { getBalance } from "@/lib/wallet";
import { dirFor, webCopy } from "@/lib/web-copy";

export const dynamic = "force-dynamic";
export const metadata = { title: "Watchat · قائمتي" };

function Poster({ url, alt }: { url: string | null; alt: string }) {
  return (
    <div className="wc-poster">
      {url ? <img src={url} alt="" loading="lazy" /> : <span className="wc-poster-fallback">{alt}</span>}
    </div>
  );
}

export default async function MyListPage() {
  const viewer = await getSessionViewer();
  if (!viewer) redirect("/me");
  const locale = viewer.uiLocale;
  const t = webCopy(locale);
  const [{ watching, more }, balance] = await Promise.all([getLibrary(viewer.id), getBalance(viewer.id)]);
  const title = (s: { titleAr: string; titleEn: string }) => (locale === "en" ? s.titleEn : s.titleAr);
  const inProgress = watching.filter((s) => s.resume);
  const finished = watching.filter((s) => !s.resume);

  return (
    <div className="wc wc-app" dir={dirFor(locale)} lang={locale}>
      <TopBar locale={locale} balance={balance} />
      <main style={{ maxWidth: 600, margin: "0 auto", padding: "8px 16px 0", display: "flex", flexDirection: "column", gap: 24 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700 }}>{t.myList}</h1>

        <section aria-labelledby="h-cw" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 id="h-cw" className="wc-section-title">{t.continueWatching}</h2>
          {inProgress.length === 0 ? (
            <p className="wc-card" style={{ padding: 20, color: "var(--wc-muted)" }}>
              {t.nothingYet}{" "}
              <Link href="/" style={{ color: "var(--wc-mint-text)", fontWeight: 600 }}>{t.home}</Link>
            </p>
          ) : (
            inProgress.map((s) => (
              <Link key={s.code} href={`/watch/${s.code}/${s.resume}`} className="wc-card" style={{ padding: 12, display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ width: 72, flexShrink: 0 }}>
                  <Poster url={s.posterUrl} alt={title(s)} />
                </div>
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  <strong style={{ fontWeight: 600, fontSize: 17 }}>{title(s)}</strong>
                  <span style={{ fontSize: 13, color: "var(--wc-muted)" }}>{t.epOf(s.resume as number, s.total)}</span>
                  <div className="wc-progress">
                    <span style={{ width: `${Math.max(4, Math.round((((s.resume as number) - 1) / Math.max(s.total, 1)) * 100))}%` }} />
                  </div>
                </div>
                <span aria-hidden="true" style={{ width: 48, height: 48, flexShrink: 0, borderRadius: "50%", background: "var(--wc-mint)", display: "grid", placeItems: "center" }}>
                  <PlayIcon size={16} fill="var(--wc-mint-ink)" />
                </span>
              </Link>
            ))
          )}
        </section>

        {finished.length > 0 && (
          <section aria-labelledby="h-fin" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <h2 id="h-fin" className="wc-section-title">{t.finishedSeries}</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
              {finished.map((s) => (
                <Link key={s.code} href={`/series/${s.code}`} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <Poster url={s.posterUrl} alt={title(s)} />
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{title(s)}</span>
                  <span style={{ fontSize: 12, color: "var(--wc-mint-text)", fontWeight: 600 }}>{t.finished}</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {more.length > 0 && (
          <section aria-labelledby="h-more" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <h2 id="h-more" className="wc-section-title">{t.moreSeries}</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
              {more.map((s) => (
                <Link key={s.code} href={`/series/${s.code}`} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <Poster url={s.posterUrl} alt={title(s)} />
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{title(s)}</span>
                  <span style={{ fontSize: 12, color: "var(--wc-muted)" }}>{t.episodesCount(s.total)}</span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>
      <BottomNav locale={locale} current="list" />
    </div>
  );
}
