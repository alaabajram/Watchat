"use client";

// Full-screen vertical watch feed: every episode of the series is one full-screen slide; scroll (swipe) up for
// the next episode and down for the previous one. Only the episode on screen plays (one video at a time, so data
// isn't wasted). Title, episode number, back, coins, and the Share / Info buttons float over the video and fade
// out a few seconds after the last touch. Tap the screen to show them, tap again to hide them; pause / play is the
// button in the middle that comes with them.
// The address bar follows the episode on screen, so refreshing, sharing the page or unlocking stays on it.

import { useCallback, useEffect, useRef, useState } from "react";
import { Paywall } from "@/components/Paywall";
import { webCopy, type Locale } from "@/lib/web-copy";

export type FeedEpisode = { id: string; number: number; hls: string | null; poster: string | null; allowed: boolean; price: number };

type Props = {
  locale: Locale;
  seriesCode: string;
  seriesId: string;
  title: string;
  synopsis: string | null;
  episodes: FeedEpisode[];
  startNumber: number;
  startAt: number;
  subtitleLang: "ar" | "en";
  shareHref: string | null;
  balance: number;
  trusted: boolean;
  seasonPassLabel: string | null;
};

const HIDE_AFTER_MS = 3500;
const HEARTBEAT_MS = 10_000;

const T = {
  ar: { swipe: "اسحب للأعلى للحلقة التالية", info: "التفاصيل", allEpisodes: "كل الحلقات", close: "إغلاق", episodes: (n: number) => `${n} حلقة`, back: "رجوع" },
  en: { swipe: "Swipe up for the next episode", info: "Info", allEpisodes: "All episodes", close: "Close", episodes: (n: number) => `${n} episodes`, back: "Back" },
} as const;

export function WatchFeed(p: Props) {
  const t = webCopy(p.locale);
  const L = T[p.locale];
  const feed = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(p.startNumber);
  const [shown, setShown] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [info, setInfo] = useState(false);
  const [hint, setHint] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = p.episodes.find((e) => e.number === active) ?? p.episodes[0];
  const idx = p.episodes.findIndex((e) => e.number === active);

  // Overlays: show now, fade out a few seconds later while the video plays.
  const playingRef = useRef(false);
  playingRef.current = playing;
  const poke = useCallback(() => {
    setShown(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    // While paused they stay until the viewer taps them away.
    if (playingRef.current) hideTimer.current = setTimeout(() => setShown(false), HIDE_AFTER_MS);
  }, []);
  const hide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setShown(false);
  }, []);
  /** A tap on the screen: show the overlays, or hide them if they're showing. */
  const tapScreen = useCallback(() => (shown ? hide() : poke()), [shown, hide, poke]);
  useEffect(() => {
    if (info) {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setShown(true);
    } else if (playing) poke();
    else if (hideTimer.current) clearTimeout(hideTimer.current); // paused: leave them as they are
  }, [playing, info, poke]);

  // Start on the episode from the address, then follow whichever slide is on screen.
  useEffect(() => {
    const el = feed.current?.querySelector<HTMLElement>(`[data-n="${p.startNumber}"]`);
    el?.scrollIntoView({ behavior: "instant" as ScrollBehavior, block: "start" });
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.n));
      },
      { root: feed.current, threshold: 0.6 },
    );
    feed.current?.querySelectorAll("[data-n]").forEach((s) => io.observe(s));
    try {
      if (!localStorage.getItem("wc-swipe-hint") && p.episodes.length > 1) {
        setHint(true);
        localStorage.setItem("wc-swipe-hint", "1");
        setTimeout(() => setHint(false), 3200);
      }
    } catch {
      /* storage unavailable */
    }
    return () => io.disconnect();
  }, [p.startNumber, p.episodes.length]);

  useEffect(() => {
    setProgress(0);
    setInfo(false);
    poke();
    const path = `/watch/${p.seriesCode}/${active}`;
    if (window.location.pathname !== path) window.history.replaceState(window.history.state, "", path);
  }, [active, p.seriesCode, poke]);

  const go = useCallback(
    (delta: 1 | -1) => {
      const target = p.episodes[idx + delta];
      if (target) feed.current?.querySelector<HTMLElement>(`[data-n="${target.number}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [idx, p.episodes],
  );

  // Keyboard on computers: arrows move between episodes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "PageDown") (e.preventDefault(), go(1));
      if (e.key === "ArrowUp" || e.key === "PageUp") (e.preventDefault(), go(-1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  const fade = { opacity: shown ? 1 : 0, pointerEvents: shown ? "auto" : "none", transition: "opacity 0.35s ease" } as const;

  return (
    <div className="wc wc-dark wc-watch" dir={p.locale === "ar" ? "rtl" : "ltr"} lang={p.locale}>
      <div ref={feed} className="wc-feed" aria-label={p.title}>
        {p.episodes.map((ep) => (
          <section key={ep.id} data-n={ep.number} className="wc-slide" aria-label={t.episode(ep.number)} onClick={ep.number === active && ep.allowed && ep.hls ? undefined : tapScreen}>
            {ep.number === active && ep.allowed && ep.hls ? (
              <EpisodeVideo
                key={ep.id}
                ep={ep}
                startAt={ep.number === p.startNumber ? p.startAt : 0}
                subtitleLang={p.subtitleLang}
                label={`${p.title} · ${t.episode(ep.number)}`}
                onPlaying={setPlaying}
                onProgress={setProgress}
                onTap={tapScreen}
                onControl={poke}
                controlsShown={shown}
                onEnded={() => go(1)}
                hasNext={idx < p.episodes.length - 1}
                locale={p.locale}
              />
            ) : (
              <>
                {ep.poster && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ep.poster} alt="" loading="lazy" className="wc-slide-poster" style={ep.allowed ? undefined : { filter: "blur(10px) brightness(0.5)" }} />
                )}
                {(!ep.allowed || !ep.hls) && (
                  <div className="wc-slide-note">
                    {!ep.allowed ? (
                      <>
                        <span aria-hidden="true" style={{ fontSize: 34 }}>🔒</span>
                        {t.locked}
                      </>
                    ) : (
                      t.videoComingSoon
                    )}
                  </div>
                )}
              </>
            )}
          </section>
        ))}
      </div>

      {/* Top: back and coins */}
      <div className="wc-watch-top" style={fade}>
        <a href={`/series/${p.seriesCode}`} className="wc-glass" aria-label={L.back}>
          <span aria-hidden="true" style={{ display: "inline-block", transform: p.locale === "ar" ? "scaleX(-1)" : undefined }}>
            ‹
          </span>
          {t.episodes}
        </a>
        <a href={`/store?back=${encodeURIComponent(`/watch/${p.seriesCode}/${active}`)}`} className="wc-glass" aria-label={t.getCoins}>
          <span className="wc-coin" aria-hidden="true" style={{ width: 18, height: 18, borderRadius: "50%", background: "#f5b323", boxShadow: "inset 0 0 0 3px #ffd877", display: "inline-block" }} />
          {p.balance}
        </a>
      </div>

      {/* Side buttons (left in Arabic, right in English) */}
      <div className="wc-watch-rail" style={current.allowed ? fade : { display: "none" }}>
        {p.shareHref && (
          <a href={p.shareHref} target="_blank" rel="noopener noreferrer" className="wc-rail-btn" onClick={poke}>
            <span className="wc-rail-icon" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 2 11 13" />
                <path d="M22 2 15 22l-4-9-9-4 20-7z" />
              </svg>
            </span>
            {t.share}
          </a>
        )}
        <button type="button" className="wc-rail-btn" onClick={() => setInfo(true)}>
          <span className="wc-rail-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 11v6M12 7.5v.5" />
            </svg>
          </span>
          {L.info}
        </button>
      </div>

      {/* Title and episode */}
      <div className="wc-watch-caption" style={current.allowed ? fade : { display: "none" }}>
        <strong>{p.title}</strong>
        <span>
          {t.episode(current.number)} · {t.of(current.number, p.episodes.length)}
        </span>
      </div>

      {/* Thin progress line (always there, like the reference) */}
      <div className="wc-watch-progress" aria-hidden="true">
        <span style={{ width: `${Math.round(progress * 1000) / 10}%` }} />
      </div>

      {hint && (
        <div className="wc-watch-hint" role="status">
          <span aria-hidden="true">↑</span> {L.swipe}
        </div>
      )}

      {info && (
        <div className="wc-watch-sheet" role="dialog" aria-modal="true" aria-label={p.title} onClick={() => setInfo(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ background: "#1b1722", color: "#fff" }}>
            <strong style={{ fontSize: 20 }}>{p.title}</strong>
            <span style={{ opacity: 0.7 }}>{L.episodes(p.episodes.length)}</span>
            {p.synopsis && <p style={{ margin: 0, lineHeight: 1.6, opacity: 0.9 }}>{p.synopsis}</p>}
            <a className="btn" href={`/series/${p.seriesCode}`}>
              {L.allEpisodes}
            </a>
            <button type="button" className="btn secondary" onClick={() => setInfo(false)}>
              {L.close}
            </button>
          </div>
        </div>
      )}

      {!current.allowed && (
        <div className="wc-watch-sheet" style={{ background: "transparent", pointerEvents: "none" }}>
          <div style={{ pointerEvents: "auto", width: "100%" }}>
            <Paywall
              key={current.id}
              locale={p.locale}
              episodeId={current.id}
              price={current.price}
              balance={p.balance}
              trusted={p.trusted}
              seriesCode={p.seriesCode}
              seriesId={p.seriesId}
              seasonPassLabel={p.seasonPassLabel}
              returnTo={`/watch/${p.seriesCode}/${current.number}`}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** The video of the episode on screen: adaptive HLS, resume, progress saving, tap to pause, auto-next at the end. */
function EpisodeVideo(p: {
  ep: FeedEpisode;
  startAt: number;
  subtitleLang: "ar" | "en";
  label: string;
  onPlaying: (b: boolean) => void;
  onProgress: (f: number) => void;
  onTap: () => void;
  /** Pressing the play / pause button keeps the overlays up a little longer. */
  onControl: () => void;
  controlsShown: boolean;
  onEnded: () => void;
  hasNext: boolean;
  locale: Locale;
}) {
  const t = webCopy(p.locale);
  const video = useRef<HTMLVideoElement>(null);
  const lastSent = useRef(0);
  const [needsTap, setNeedsTap] = useState(false);
  const [ended, setEnded] = useState(false);
  const [paused, setPaused] = useState(true);
  const { onPlaying, onProgress, onEnded } = p;

  const report = useCallback(
    (isEnded = false) => {
      const v = video.current;
      if (!v || !Number.isFinite(v.duration)) return;
      lastSent.current = Date.now();
      void fetch("/api/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ episodeId: p.ep.id, position: v.currentTime, duration: v.duration, ended: isEnded }),
        keepalive: true,
      }).catch(() => undefined);
    },
    [p.ep.id],
  );

  useEffect(() => {
    const v = video.current;
    if (!v || !p.ep.hls) return;
    let hls: { destroy(): void } | null = null;
    const onMeta = () => {
      if (p.startAt > 5 && p.startAt < v.duration - 5) v.currentTime = p.startAt;
      for (const track of Array.from(v.textTracks)) track.mode = p.subtitleLang === "en" && track.language?.startsWith("en") ? "showing" : "disabled";
      v.play().catch(() => setNeedsTap(true));
    };
    v.addEventListener("loadedmetadata", onMeta);
    if (v.canPlayType("application/vnd.apple.mpegurl")) v.src = p.ep.hls;
    else
      void import("hls.js").then(({ default: Hls }) => {
        if (!Hls.isSupported()) return void (v.src = p.ep.hls!);
        const instance = new Hls({ startLevel: 0, capLevelToPlayerSize: true });
        instance.loadSource(p.ep.hls!);
        instance.attachMedia(v);
        hls = instance;
      });
    return () => {
      v.removeEventListener("loadedmetadata", onMeta);
      report(); // leaving this episode (scrolled away): keep the place
      hls?.destroy();
      onPlaying(false);
    };
  }, [p.ep.hls, p.startAt, p.subtitleLang, report, onPlaying]);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const onTime = () => {
      if (Number.isFinite(v.duration) && v.duration > 0) onProgress(v.currentTime / v.duration);
      if (Date.now() - lastSent.current > HEARTBEAT_MS) report();
    };
    const onPlay = () => (onPlaying(true), setPaused(false), setNeedsTap(false));
    const onPause = () => (onPlaying(false), setPaused(true), report());
    const onEnd = () => {
      report(true);
      setEnded(true);
    };
    const onHide = () => document.visibilityState === "hidden" && report();
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onEnd);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onEnd);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [report, onPlaying, onProgress]);

  // At the end: a short countdown, then scroll to the next episode.
  const [count, setCount] = useState(3);
  useEffect(() => {
    if (!ended || !p.hasNext) return;
    if (count <= 0) return void onEnded();
    const id = setTimeout(() => setCount((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [ended, count, p.hasNext, onEnded]);

  const toggle = () => {
    const v = video.current;
    p.onControl();
    if (!v) return;
    if (v.paused) v.play().catch(() => setNeedsTap(true));
    else v.pause();
  };

  return (
    <>
      <video ref={video} playsInline preload="auto" poster={p.ep.poster ?? undefined} onClick={p.onTap} aria-label={p.label} className="wc-slide-video" />
      {(needsTap || p.controlsShown) && !ended && (
        <button
          className="wc-play-btn"
          type="button"
          onClick={toggle}
          aria-label={paused ? "Play" : "Pause"}
          style={{ transition: "opacity 0.35s ease" }}
        >
          {paused ? "▶" : "❚❚"}
        </button>
      )}
      {ended && (
        <div className="wc-slide-note" style={{ gap: 14 }}>
          {p.hasNext ? (
            <>
              <span>{t.playingNextIn(count)}</span>
              <button className="btn" type="button" onClick={onEnded}>
                {t.playNow}
              </button>
            </>
          ) : (
            <span style={{ fontSize: 22, fontWeight: 700 }}>{t.finaleTitle}</span>
          )}
        </div>
      )}
    </>
  );
}
