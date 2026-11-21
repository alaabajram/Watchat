// P4 Player + P8 paywall as a full-screen vertical feed (scroll for next / previous episode). The viewer is
// recognised silently from their session cookie, resumes where they stopped, and pays from the wallet tied to
// their WhatsApp number.

import { notFound } from "next/navigation";
import { shareHref } from "@/components/ShareButton";
import { WatchFeed, type FeedEpisode } from "@/components/watch/WatchFeed";
import { canWatch, getEpisodes, getPosition, getSeriesByCode, getUnlocked, streamUrls } from "@/lib/content";
import { env } from "@/lib/env";
import { trackEvent } from "@/lib/events";
import { currencyFor } from "@/lib/phone";
import { getSessionViewer } from "@/lib/session";
import { getBalance } from "@/lib/wallet";
import { dirFor, formatMoney, webCopy } from "@/lib/web-copy";

export const dynamic = "force-dynamic";

export default async function WatchPage({ params }: { params: Promise<{ code: string; episode: string }> }) {
  const { code, episode } = await params;
  const number = Number.parseInt(episode, 10);
  if (!Number.isFinite(number) || number < 1) notFound();

  const viewer = await getSessionViewer();
  const locale = viewer?.uiLocale ?? "ar";
  const t = webCopy(locale);

  if (!viewer) {
    const wa = env.waDisplayNumber ? `https://wa.me/${env.waDisplayNumber}?text=LINK` : null;
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

  const [unlocked, balance, startAt] = await Promise.all([
    getUnlocked(viewer.id, series.id),
    getBalance(viewer.id),
    getPosition(viewer.id, current.id),
  ]);
  const allowed = canWatch(series, number, unlocked);
  const title = locale === "en" ? series.titleEn : series.titleAr;

  await trackEvent({
    viewerHmac: viewer.phoneHmac,
    name: allowed ? "episode_started" : "paywall_viewed",
    seriesId: series.id,
    episodeNumber: number,
  });

  const currency = currencyFor(viewer.country);
  const passPrice = currency === "SAR" ? series.seasonPassPriceSar : series.seasonPassPriceAed;
  // Every episode is a slide in the full-screen feed; only the one on screen loads its video.
  const feed: FeedEpisode[] = episodes.map((e) => {
    const { hls, poster } = streamUrls(e.streamUid, env.streamCustomerCode);
    return { id: e.id, number: e.number, hls, poster, allowed: canWatch(series, e.number, unlocked), price: e.coinPrice ?? series.coinsPerEpisode };
  });

  return (
    <WatchFeed
      locale={locale}
      seriesCode={series.code}
      seriesId={series.id}
      title={title}
      synopsis={(locale === "en" ? series.synopsisEn : series.synopsisAr) ?? null}
      episodes={feed}
      startNumber={number}
      startAt={startAt}
      subtitleLang={viewer.language === "ar_en_subs" ? "en" : "ar"}
      shareHref={shareHref(series.code, title, locale)}
      balance={balance}
      trusted={viewer.trusted}
      seasonPassLabel={passPrice !== null ? t.seasonPassPrice(formatMoney(passPrice, currency, locale)) : null}
    />
  );
}
