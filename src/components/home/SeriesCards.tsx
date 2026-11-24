// Cards for the dark home / explore / series pages: the trending card (poster + views), the "you might like"
// card (poster with language badge and tag) and the small language badge. Server components.

/* eslint-disable @next/next/no-img-element */
import { kindLabel } from "@/lib/catalogue-meta";
import Link from "next/link";
import { FlameIcon, PlayIcon, TranslateIcon } from "@/components/brand/icons";
import { compactCount, type HomeSeries } from "@/lib/content";
import { GENRE_LABELS } from "@/lib/content-meta";
import { webCopy, type Locale } from "@/lib/web-copy";

export const genreLabel = (g: string, locale: Locale) => (GENRE_LABELS as Record<string, { ar: string; en: string }>)[g]?.[locale] ?? g;
export const seriesTitle = (s: { titleAr: string; titleEn: string }, locale: Locale) => (locale === "en" ? s.titleEn : s.titleAr);

/** "EN" with the translate mark when the series has an English dub or English subtitles. */
export function LangBadge({ s, locale }: { s: Pick<HomeSeries, "dub" | "subs">; locale: Locale }) {
  if (!s.dub && !s.subs) return null;
  const t = webCopy(locale);
  return (
    <span className="wc-tag" title={s.dub ? t.engDub : t.engSubs}>
      <TranslateIcon size={13} /> EN
    </span>
  );
}

/** Status line: "Ep. 48 · Complete" or "Updating · Ep. 32". */
export function statusLine(s: HomeSeries, locale: Locale) {
  const t = webCopy(locale);
  return s.complete ? `${t.episodesCount(s.total)} · ${t.complete}` : t.updatingEp(s.total);
}

/** Trending row card: poster with ▶ views, title, status. */
export function TrendCard({ s, locale }: { s: HomeSeries; locale: Locale }) {
  const title = seriesTitle(s, locale);
  return (
    <Link href={`/series/${s.code}`} className="wc-trend">
      <div className="wc-poster">
        {s.posterUrl ? <img src={s.posterUrl} alt="" loading="lazy" /> : <span className="wc-poster-fallback">{title}</span>}
        <span className="wc-poster-shade" />
        {s.views > 0 && (
          <span className="wc-views">
            <PlayIcon size={11} /> {compactCount(s.views, locale)}
          </span>
        )}
        {s.rank !== null && s.rank <= 3 && <span className="wc-rank">#{s.rank}</span>}
      </div>
      <strong className="wc-clamp1">{title}</strong>
      <span className={s.complete ? "wc-sub wc-clamp1" : "wc-sub wc-sub-hot wc-clamp1"}>{statusLine(s, locale)}</span>
    </Link>
  );
}

/** "You might like" card: poster with EN badge and a tag (TOP / NEW / HOT), title inside and below, genres. */
export function LikeCard({ s, locale, tag }: { s: HomeSeries; locale: Locale; tag?: { text: string; tone: "mint" | "coral" } | null }) {
  const title = seriesTitle(s, locale);
  return (
    <Link href={`/series/${s.code}`} className="wc-like">
      <div className="wc-poster">
        {s.posterUrl ? <img src={s.posterUrl} alt="" loading="lazy" /> : <span className="wc-poster-fallback">{title}</span>}
        <span className="wc-poster-shade" />
        <span style={{ position: "absolute", top: 8, insetInlineStart: 8 }}>
          <LangBadge s={s} locale={locale} />
        </span>
        <span className="wc-like-over">
          {tag && <span className={`wc-like-tag wc-like-tag-${tag.tone}`}>{tag.text}</span>}
          <span className="wc-clamp2">{title}</span>
        </span>
      </div>
      <strong className="wc-clamp1">{title}</strong>
      <span className="wc-sub wc-clamp1">
        {s.kind !== "micro_drama" && <span className="wc-kind-tag">{kindLabel(s.kind, locale)}</span>}
        {s.genres.slice(0, s.kind === "micro_drama" ? 2 : 1).map((g) => genreLabel(g, locale)).join(" · ") || webCopy(locale).episodesCount(s.total)}
      </span>
    </Link>
  );
}

/** Section heading with a coloured bar, an optional HOT pill and a "See all" link. */
export function SectionHead({ id, title, hot, href, more, bar = "mint" }: { id: string; title: string; hot?: string; href?: string; more?: string; bar?: "mint" | "coral" }) {
  return (
    <div className="wc-head">
      <h2 id={id}>
        <span className={`wc-head-bar wc-head-bar-${bar}`} aria-hidden="true" />
        {title}
        {hot && (
          <span className="wc-hot">
            <FlameIcon size={12} /> {hot}
          </span>
        )}
      </h2>
      {href && more && (
        <Link href={href} className="wc-more">
          {more} ›
        </Link>
      )}
    </div>
  );
}
