// P4 Player (+ P8 paywall placeholder). Vertical 9:16 video from Cloudflare Stream.
// Prototype scope: plays free episodes, shows a locked sheet at the paywall. Swipe gestures, autoplay-next
// and watch-time heartbeats come next (see README → Next steps).

import Link from "next/link";
import { notFound } from "next/navigation";
import { canWatch, getEpisodes, getSeriesByCode, getUnlocked } from "@/lib/content";
import { env } from "@/lib/env";
import { trackEvent } from "@/lib/events";
import { getSessionViewer } from "@/lib/session";
import { db } from "@/lib/supabase";
import { dirFor, webCopy } from "@/lib/web-copy";

export const dynamic = "force-dynamic";

export default async function WatchPage({ params }: { params: Promise<{ code: string; episode: string }> }) {
  const { code, episode } = await params;
  const number = Number.parseInt(episode, 10);
  if (!Number.isFinite(number) || number < 1) notFound();

  const viewer = await getSessionViewer();
  const locale = viewer?.uiLocale ?? "ar";
  const t = webCopy(locale);
  const wa = env.waDisplayNumber ? `https://wa.me/${env.waDisplayNumber}?text=LINK` : null;

  if (!viewer) {
    return (
      <main className="page center" dir={dirFor(locale)}>
        <p>{t.signInFromWhatsApp}</p>
        {wa && (
          <a className="btn" href={wa}>
            {t.getFreshLink}
          </a>
        )}
      </main>
    );
  }

  const series = await getSeriesByCode(code);
  if (!series) notFound();
  const episodes = await getEpisodes(series.id);
  const current = episodes.find((e) => e.number === number);
  if (!current) notFound();

  const unlocked = await getUnlocked(viewer.id, series.id);
  const allowed = canWatch(series, number, unlocked);
  const title = locale === "en" ? series.titleEn : series.titleAr;
  const total = episodes.length;
  const prev = episodes.find((e) => e.number === number - 1);
  const next = episodes.find((e) => e.number === number + 1);

  if (allowed) {
    // Record that the episode started (drives "continue watching" and the funnel).
    await db()
      .from("progress")
      .upsert(
        { viewer_id: viewer.id, episode_id: current.id, updated_at: new Date().toISOString() },
        { onConflict: "viewer_id,episode_id", ignoreDuplicates: false },
      );
    await trackEvent({ viewerHmac: viewer.phoneHmac, name: "episode_started", seriesId: series.id, episodeNumber: number });
  } else {
    await trackEvent({ viewerHmac: viewer.phoneHmac, name: "paywall_viewed", seriesId: series.id, episodeNumber: number });
  }

  const subtitleLang = viewer.language === "ar_en_subs" ? "en" : "ar";
  const streamSrc =
    current.streamUid && env.streamCustomerCode
      ? `https://customer-${env.streamCustomerCode}.cloudflarestream.com/${current.streamUid}/iframe?autoplay=true&preload=auto&defaultTextTrack=${subtitleLang}`
      : null;

  return (
    <main dir={dirFor(locale)}>
      <div className="player">
        {allowed && streamSrc ? (
          <iframe
            src={streamSrc}
            title={`${title} · ${t.episode(number)}`}
            allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        ) : (
          <div className="placeholder">{allowed ? t.videoComingSoon : t.locked}</div>
        )}
      </div>

      <div className="player-bar">
        <div>
          <strong>{title}</strong>
          <div className="muted">{t.of(number, total)}</div>
        </div>
        <Link className="btn secondary" href={`/series/${series.code}`}>
          {t.episodes}
        </Link>
      </div>

      {!allowed && (
        <div className="sheet">
          <strong>{t.paywallTitle}</strong>
          <button className="btn" type="button" disabled>
            {t.unlockFor(current.coinPrice ?? series.coinsPerEpisode)}
          </button>
          {series.seasonPassPriceAed !== null && (
            <button className="btn secondary" type="button" disabled>
              {t.seasonPass(series.seasonPassPriceAed)}
            </button>
          )}
          <p className="muted" style={{ margin: 0 }}>
            {t.paywallBody}
          </p>
        </div>
      )}

      <nav className="player-bar">
        {prev ? (
          <Link className="btn secondary" href={`/watch/${series.code}/${prev.number}`}>
            {t.previous}
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link className="btn" href={`/watch/${series.code}/${next.number}`}>
            {t.next}
          </Link>
        )}
      </nav>
    </main>
  );
}
