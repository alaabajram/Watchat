// P4 Player + P8 paywall. The viewer is recognised silently from their session cookie, resumes where
// they stopped, and pays from the wallet tied to their WhatsApp number.

import Link from "next/link";
import { notFound } from "next/navigation";
import { Paywall } from "@/components/Paywall";
import { Player } from "@/components/Player";
import { ShareButton } from "@/components/ShareButton";
import { TopBar } from "@/components/TopBar";
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
  const prev = episodes.find((e) => e.number === number - 1);
  const next = episodes.find((e) => e.number === number + 1);
  const returnTo = `/watch/${series.code}/${number}`;

  await trackEvent({
    viewerHmac: viewer.phoneHmac,
    name: allowed ? "episode_started" : "paywall_viewed",
    seriesId: series.id,
    episodeNumber: number,
  });

  const currency = currencyFor(viewer.country);
  const passPrice = currency === "SAR" ? series.seasonPassPriceSar : series.seasonPassPriceAed;
  const { hls, poster } = streamUrls(current.streamUid, env.streamCustomerCode);

  return (
    <main className="wc wc-dark" dir={dirFor(locale)} lang={locale}>
      <TopBar locale={locale} balance={balance} backHref={`/series/${series.code}`} backLabel={t.episodes} dark />

      {allowed ? (
        <Player
          locale={locale}
          episodeId={current.id}
          src={hls}
          poster={poster}
          startAt={startAt}
          subtitleLang={viewer.language === "ar_en_subs" ? "en" : "ar"}
          nextHref={next ? `/watch/${series.code}/${next.number}` : null}
          prevHref={prev ? `/watch/${series.code}/${prev.number}` : null}
          seriesHref={`/series/${series.code}`}
          title={`${title} · ${t.episode(number)}`}
        />
      ) : (
        <div className="player">
          {poster && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={poster} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", filter: "blur(8px) brightness(0.5)" }} />
          )}
          <div className="placeholder" style={{ fontWeight: 600 }}>{t.locked}</div>
        </div>
      )}

      <div className="player-bar">
        <div style={{ minWidth: 0 }}>
          <strong style={{ fontWeight: 600 }}>{title}</strong>
          <div className="muted" style={{ fontSize: 14 }}>
            {t.episode(number)} · {t.of(number, episodes.length)}
          </div>
        </div>
        <nav style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <ShareButton code={series.code} title={title} locale={locale} dark />
          {prev && (
            <Link className="btn secondary" href={`/watch/${series.code}/${prev.number}`}>
              {t.previous}
            </Link>
          )}
          {next && allowed && (
            <Link className="btn" href={`/watch/${series.code}/${next.number}`}>
              {t.next}
            </Link>
          )}
        </nav>
      </div>

      {!allowed && (
        <Paywall
          locale={locale}
          episodeId={current.id}
          price={current.coinPrice ?? series.coinsPerEpisode}
          balance={balance}
          trusted={viewer.trusted}
          seriesCode={series.code}
          seriesId={series.id}
          seasonPassLabel={passPrice !== null ? t.seasonPassPrice(formatMoney(passPrice, currency, locale)) : null}
          returnTo={returnTo}
        />
      )}
    </main>
  );
}
