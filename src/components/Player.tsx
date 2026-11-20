"use client";

// P4/P5 — full-screen vertical player.
// Adaptive HLS from Cloudflare Stream (native on Safari/iOS, hls.js elsewhere), starts at the lowest
// quality and steps up, resumes where the viewer stopped, saves progress every 10 s, swipe up/down for
// next/previous, tap to pause, and a 5-second "next episode" countdown (or the finale screen) at the end.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { webCopy, type Locale } from "@/lib/web-copy";

type Props = {
  locale: Locale;
  episodeId: string;
  src: string | null; // HLS manifest URL
  poster: string | null;
  startAt: number; // seconds
  subtitleLang: "ar" | "en";
  nextHref: string | null;
  prevHref: string | null;
  seriesHref: string;
  title: string;
};

const HEARTBEAT_MS = 10_000;
const SWIPE_PX = 60;

export function Player(p: Props) {
  const t = webCopy(p.locale);
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const lastSent = useRef(0);
  const touchY = useRef<number | null>(null);
  const [needsTap, setNeedsTap] = useState(false);
  const [ended, setEnded] = useState(false);
  const [countdown, setCountdown] = useState(5);

  const report = useCallback(
    (isEnded = false) => {
      const v = video.current;
      if (!v || !Number.isFinite(v.duration)) return;
      lastSent.current = Date.now();
      void fetch("/api/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ episodeId: p.episodeId, position: v.currentTime, duration: v.duration, ended: isEnded }),
        keepalive: true,
      }).catch(() => undefined);
    },
    [p.episodeId],
  );

  // Attach the stream.
  useEffect(() => {
    const v = video.current;
    if (!v || !p.src) return;
    let hls: { destroy(): void } | null = null;

    const onMeta = () => {
      if (p.startAt > 5 && p.startAt < v.duration - 5) v.currentTime = p.startAt;
      for (const track of Array.from(v.textTracks)) {
        track.mode = track.language?.startsWith(p.subtitleLang) && p.subtitleLang === "en" ? "showing" : "disabled";
      }
      v.play().catch(() => setNeedsTap(true));
    };
    v.addEventListener("loadedmetadata", onMeta);

    if (v.canPlayType("application/vnd.apple.mpegurl")) {
      v.src = p.src;
    } else {
      void import("hls.js").then(({ default: Hls }) => {
        if (!Hls.isSupported()) {
          v.src = p.src!;
          return;
        }
        const instance = new Hls({ startLevel: 0, capLevelToPlayerSize: true });
        instance.loadSource(p.src!);
        instance.attachMedia(v);
        hls = instance;
      });
    }
    return () => {
      v.removeEventListener("loadedmetadata", onMeta);
      hls?.destroy();
    };
  }, [p.src, p.startAt, p.subtitleLang]);

  // Heartbeat while playing; save on pause and when leaving.
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const onTime = () => {
      if (Date.now() - lastSent.current > HEARTBEAT_MS) report();
    };
    const onPause = () => report();
    const onEnded = () => {
      report(true);
      setEnded(true);
    };
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onEnded);
    const onHide = () => document.visibilityState === "hidden" && report();
    document.addEventListener("visibilitychange", onHide);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onEnded);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [report]);

  // Countdown to the next episode.
  useEffect(() => {
    if (!ended || !p.nextHref) return;
    if (countdown <= 0) {
      router.push(p.nextHref);
      return;
    }
    const id = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [ended, countdown, p.nextHref, router]);

  // Keyboard: arrows for next/previous, space to pause.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" && p.nextHref) router.push(p.nextHref);
      if (e.key === "ArrowUp" && p.prevHref) router.push(p.prevHref);
      if (e.key === " ") {
        e.preventDefault();
        const v = video.current;
        if (v) (v.paused ? v.play() : v.pause())?.catch?.(() => undefined);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [p.nextHref, p.prevHref, router]);

  const togglePlay = () => {
    const v = video.current;
    if (!v) return;
    setNeedsTap(false);
    if (v.paused) v.play().catch(() => setNeedsTap(true));
    else v.pause();
  };

  return (
    <div
      className="player"
      onTouchStart={(e) => (touchY.current = e.touches[0]?.clientY ?? null)}
      onTouchEnd={(e) => {
        const start = touchY.current;
        touchY.current = null;
        const end = e.changedTouches[0]?.clientY;
        if (start === null || end === undefined) return;
        const dy = end - start;
        if (dy < -SWIPE_PX && p.nextHref) router.push(p.nextHref);
        else if (dy > SWIPE_PX && p.prevHref) router.push(p.prevHref);
      }}
    >
      {p.src ? (
        <video
          ref={video}
          playsInline
          preload="auto"
          poster={p.poster ?? undefined}
          onClick={togglePlay}
          aria-label={p.title}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", background: "#000" }}
        />
      ) : (
        <div className="placeholder">{t.videoComingSoon}</div>
      )}

      {needsTap && !ended && (
        <button className="overlay-btn" type="button" onClick={togglePlay} aria-label="Play">
          ▶
        </button>
      )}

      {ended && (
        <div className="overlay">
          {p.nextHref ? (
            <>
              <p>{t.playingNextIn(countdown)}</p>
              <button className="btn" type="button" onClick={() => router.push(p.nextHref!)}>
                {t.playNow}
              </button>
              <button className="btn secondary" type="button" onClick={() => setEnded(false)}>
                {t.cancel}
              </button>
            </>
          ) : (
            <>
              <p style={{ fontSize: 22, fontWeight: 700 }}>{t.finaleTitle}</p>
              <a className="btn" href={p.seriesHref}>
                {t.backToEpisodes}
              </a>
            </>
          )}
        </div>
      )}
    </div>
  );
}
