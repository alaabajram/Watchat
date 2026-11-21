"use client";
// Home hero: featured series as big poster cards (swipe between them). Each card: status pill and TOP badge on
// the poster, Watch now, quality / language chip, then title, genres, bookmark, views, episodes and Share.
// Native scroll-snap (swipe works without JS); dots follow the scroll; gentle auto-advance until touched.

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PlayIcon, ShareIcon } from "@/components/brand/icons";
import { BookmarkButton } from "./BookmarkButton";

export type Slide = {
  key: string;
  href: string;
  title: string;
  imageUrl: string | null;
  cta: string;
  status: string;
  /** "TOP #1" when it's among the most watched. */
  top: string | null;
  /** "HD · Eng Dub" */
  chip: string;
  genres: string;
  views: string | null;
  episodes: string;
  share: { href: string; label: string } | null;
  bookmark: { code: string; saved: boolean; labels: { add: string; remove: string } };
};

// slideLabels: one accessible label per slide ("Slide 1 of 5"), built on the server — functions can't be passed to client components.
export function BannerCarousel({ slides, label, slideLabels }: { slides: Slide[]; label: string; slideLabels: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      const w = el.firstElementChild instanceof HTMLElement ? el.firstElementChild.offsetWidth + 12 : el.clientWidth;
      setActive(Math.min(slides.length - 1, Math.round(Math.abs(el.scrollLeft) / w)));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [slides.length]);

  useEffect(() => {
    if (paused || slides.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => go((active + 1) % slides.length), 6000);
    return () => window.clearInterval(id);
  });

  function go(i: number) {
    const el = ref.current;
    const child = el?.children[i] as HTMLElement | undefined;
    if (el && child) child.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
  }

  return (
    <section aria-roledescription="carousel" aria-label={label} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div ref={ref} className="wc-scroller" onPointerDown={() => setPaused(true)} onFocus={() => setPaused(true)}>
        {slides.map((s, i) => (
          <article key={s.key} role="group" aria-roledescription="slide" aria-label={slideLabels[i] ?? ""} className="wc-hero">
            <div className="wc-hero-frame">
              <Link href={s.href} className="wc-hero-art" tabIndex={-1} aria-hidden="true">
                {s.imageUrl ? <img src={s.imageUrl} alt="" /> : <span className="wc-poster-fallback">{s.title}</span>}
                <span className="wc-hero-shade" />
              </Link>
              <span className="wc-hero-status">
                <span className="wc-dot" aria-hidden="true" />
                {s.status}
              </span>
              {s.top && <span className="wc-hero-top">{s.top}</span>}
              <div className="wc-hero-actions">
                <Link href={s.href} className="wc-btn wc-btn-sm">
                  <PlayIcon size={16} />
                  {s.cta}
                </Link>
                <span className="wc-hero-chip">{s.chip}</span>
              </div>
            </div>
            <div className="wc-hero-body">
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <h2 className="wc-clamp1">{s.title}</h2>
                  {s.genres && <p className="wc-sub wc-clamp1">{s.genres}</p>}
                </div>
                <BookmarkButton code={s.bookmark.code} saved={s.bookmark.saved} labels={s.bookmark.labels} />
              </div>
              <div className="wc-hero-meta">
                {s.views && (
                  <span>
                    <PlayIcon size={13} fill="var(--wc-coral)" /> {s.views}
                  </span>
                )}
                {s.views && <span className="wc-sep" aria-hidden="true" />}
                <span>{s.episodes}</span>
                {s.share && (
                  <a href={s.share.href} target="_blank" rel="noopener noreferrer" className="wc-hero-share">
                    <ShareIcon size={16} /> {s.share.label}
                  </a>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
      {slides.length > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: 2 }}>
          {slides.map((s, i) => (
            <button
              key={s.key}
              type="button"
              aria-label={slideLabels[i] ?? ""}
              aria-current={i === active}
              onClick={() => {
                setPaused(true);
                go(i);
              }}
              style={{ width: 28, height: 28, padding: 0, border: 0, background: "transparent", display: "grid", placeItems: "center", cursor: "pointer" }}
            >
              <span style={{ width: i === active ? 22 : 7, height: 7, borderRadius: 999, background: i === active ? "var(--wc-coral)" : "#4a4356", transition: "width .2s" }} />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
