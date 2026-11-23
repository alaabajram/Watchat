// P4 Player + P8 paywall as a full-screen vertical feed (scroll for next / previous episode). The viewer is
// recognised silently from their session cookie, resumes where they stopped, and pays from the wallet tied to
// their WhatsApp number.

import { notFound } from "next/navigation";
import { shareHref } from "@/components/ShareButton";
import { WatchFeed, type FeedEpisode } from "@/components/watch/WatchFeed";
import { StoryWatch } from "@/components/story/StoryWatch";
import { canWatch, getEpisodeStory, getEpisodes, getPosition, getSeriesByCode, getStoryPosition, getUnlocked, streamUrls } from "@/lib/content";
import { storyStateOf } from "@/lib/story/server";
import { env } from "@/lib/env";
import { trackEvent } from "@/lib/events";
import { payingMarket, storeOffers } from "@/lib/economy/store";
import { getSessionViewer } from "@/lib/session";
import { playbackLangs } from "@/lib/storage/tracks";
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

  // Paywall offers in the viewer's market: the series pass (fixed fee) and the weekly pass (every series).
  const shop = allowed ? null : await storeOffers(viewer.id, await payingMarket(viewer));
  const seasonPassLabel = shop?.seriesPass ? t.seasonPassPrice(formatMoney(shop.seriesPass.price, shop.market.currency, locale)) : null;
  const weeklyPassLabel = shop?.weekly ? t.weeklyPassPrice(formatMoney(shop.weekly.price, shop.market.currency, locale)) : null;

  // Story series: the story reader (one episode per page; "Next episode" at the end). The story itself is only
  // sent for an episode the viewer may play.
  if (series.format === "story") {
    const [story, resumeAt, state] = await Promise.all([
      allowed ? getEpisodeStory(current.id) : Promise.resolve(null),
      allowed ? getStoryPosition(viewer.id, current.id) : Promise.resolve(null),
      storyStateOf(viewer.id, series.id),
    ]);
    return (
      <StoryWatch
        locale={locale}
        seriesCode={series.code}
        seriesId={series.id}
        title={title}
        posterUrl={series.posterUrl}
        episode={{ id: current.id, number, title: (locale === "en" ? current.titleEn : current.titleAr) ?? null, allowed, price: current.coinPrice ?? series.coinsPerEpisode }}
        total={episodes.length}
        hasNext={episodes.some((e) => e.number === number + 1)}
        story={story}
        style={series.storyStyle}
        characters={series.storyCharacters}
        resumeAt={resumeAt}
        flags={state.flags}
        bought={state.bought}
        balance={balance}
        trusted={viewer.trusted}
        seasonPassLabel={seasonPassLabel}
        weeklyPassLabel={weeklyPassLabel}
      />
    );
  }
  // Every episode is a slide in the full-screen feed; only the one on screen loads its video.
  const feed: FeedEpisode[] = episodes.map((e) => {
    const allowedHere = canWatch(series, e.number, unlocked);
    const { hls, poster } = streamUrls(e.streamUid, env.streamCustomerCode);
    // Locked episodes never get their video link (it would open the video without paying); unlocking refreshes the page.
    // English viewers hear the English dub when the episode has one, otherwise read English subtitles.
    const langs = playbackLangs(viewer.language, e.tracks, series.original);
    return { id: e.id, number: e.number, hls: allowedHere ? hls : null, poster, allowed: allowedHere, price: e.coinPrice ?? series.coinsPerEpisode, audioLang: langs.audio, subsLang: langs.subs };
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
      seasonPassLabel={seasonPassLabel}
      weeklyPassLabel={weeklyPassLabel}
    />
  );
}
