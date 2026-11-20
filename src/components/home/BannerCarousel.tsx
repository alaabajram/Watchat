"use client";
// Featured series carousel: native scroll-snap (swipe works without JS), dots that follow the scroll,
// and a gentle auto-advance that stops once the viewer touches it or prefers reduced motion.

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PlayIcon } from "@/components/brand/icons";

export type Slide = { key: string; href: string; title: string; tagline: string | null; badge: string | null; imageUrl: string | null; cta: string };

export function BannerCarousel({ slides, label, slideLabel }: { slides: Slide[]; label: string; slideLabel: (n: number, total: number) => string }) {
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
    const id = window.setInterval(() => go((active + 1) % slides.length), 5000);
    return () => window.clearInterval(id);
  });

  function go(i: number) {
    const el = ref.current;
    const child = el?.children[i] as HTMLElement | undefined;
    if (el && child) child.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
  }

  return (
    <section aria-roledescription="carousel" aria-label={label} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div ref={ref} className="wc-scroller" onPointerDown={() => setPaused(true)} onFocus={() => setPaused(true)}>
        {slides.map((s, i) => (
          <div
            key={s.key}
            role="group"
            aria-roledescription="slide"
            aria-label={slideLabel(i + 1, slides.length)}
            style={{ flex: "0 0 calc(100% - 32px)", maxWidth: 560, aspectRatio: "16 / 11", borderRadius: 28, background: "var(--wc-night)", position: "relative", overflow: "hidden", color: "#fff" }}
          >
            {s.imageUrl && <img src={s.imageUrl} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />}
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(19,16,26,0.92) 0%, rgba(19,16,26,0.35) 55%, rgba(19,16,26,0) 100%)" }} />
            {s.badge && (
              <span style={{ position: "absolute", top: 16, insetInlineStart: 16, padding: "4px 12px", borderRadius: 999, background: "#ffece8", color: "var(--wc-coral-text)", fontSize: 12, fontWeight: 600 }}>{s.badge}</span>
            )}
            <div style={{ position: "absolute", insetInline: 18, bottom: 18, display: "flex", flexDirection: "column", gap: 8 }}>
              <h2 style={{ fontWeight: 700, fontSize: 24, lineHeight: 1.3 }}>{s.title}</h2>
              {s.tagline && <p style={{ fontSize: 13, color: "#e4dfea" }}>{s.tagline}</p>}
              <Link href={s.href} className="wc-btn" style={{ alignSelf: "flex-start", minHeight: 44, padding: "0 18px", fontSize: 15, borderRadius: 14, boxShadow: "none" }}>
                <PlayIcon />
                {s.cta}
              </Link>
            </div>
          </div>
        ))}
      </div>
      {slides.length > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: 2 }}>
          {slides.map((s, i) => (
            <button
              key={s.key}
              type="button"
              aria-label={slideLabel(i + 1, slides.length)}
              aria-current={i === active}
              onClick={() => {
                setPaused(true);
                go(i);
              }}
              style={{ width: 28, height: 28, padding: 0, border: 0, background: "transparent", display: "grid", placeItems: "center", cursor: "pointer" }}
            >
              <span style={{ width: i === active ? 22 : 7, height: 7, borderRadius: 999, background: i === active ? "var(--wc-mint)" : "#d5d0c9", transition: "width .2s" }} />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
