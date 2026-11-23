"use client";

// The watch page of a story series: the story reader in the 9:16 frame, with back, Ping balance and the episode,
// the paywall on locked episodes, premium choices paid with Ping, and the place saved as the viewer goes.

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Paywall } from "@/components/Paywall";
import { PingIcon } from "@/components/brand/PingIcon";
import { choiceKey, type Character, type StoryGraph, type StoryStyle } from "@/lib/story/types";
import { StoryPlayer, type ChoiceResult } from "./StoryPlayer";

type Locale = "ar" | "en";

export type StoryWatchProps = {
  locale: Locale;
  seriesCode: string;
  seriesId: string;
  title: string;
  posterUrl: string | null;
  episode: { id: string; number: number; title: string | null; allowed: boolean; price: number };
  total: number;
  hasNext: boolean;
  /** Only for an episode the viewer may play. */
  story: StoryGraph | null;
  style: StoryStyle;
  characters: Character[];
  resumeAt: string | null;
  flags: string[];
  bought: string[];
  balance: number;
  trusted: boolean;
  seasonPassLabel: string | null;
  weeklyPassLabel: string | null;
};

const L = {
  ar: { episodes: "الحلقات", episode: (n: number, of: number) => `الحلقة ${n} من ${of}`, soon: "هذه الحلقة قادمة قريباً." },
  en: { episodes: "Episodes", episode: (n: number, of: number) => `Episode ${n} of ${of}`, soon: "This episode is coming soon." },
};

export function StoryWatch(p: StoryWatchProps) {
  const t = L[p.locale];
  const router = useRouter();
  const [balance, setBalance] = useState(p.balance);
  const bought = useRef(new Set(p.bought));
  const lastSave = useRef(0);
  const here = `/watch/${p.seriesCode}/${p.episode.number}`;

  const save = useCallback(
    (sceneId: string, history: string[], ended = false, ending: string | null = null) => {
      // Saves the place at most every few seconds while tapping through; the end is always saved.
      const now = Date.now();
      if (!ended && now - lastSave.current < 4000) return;
      lastSave.current = now;
      void fetch("/api/story/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ episodeId: p.episode.id, sceneId, history, ended, ending }),
        keepalive: true,
      }).catch(() => undefined);
    },
    [p.episode.id],
  );

  const onChoice = useCallback(
    async (sceneId: string, choiceId: string): Promise<ChoiceResult> => {
      const res = await fetch("/api/story/choice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ episodeId: p.episode.id, sceneId, choiceId }),
      });
      const j = (await res.json().catch(() => ({}))) as { result?: string; balance?: number };
      if (typeof j.balance === "number") setBalance(j.balance);
      if (j.result === "insufficient") return "insufficient";
      if (!res.ok || !j.result) return "error";
      bought.current.add(choiceKey(p.episode.id, sceneId, choiceId));
      return "ok";
    },
    [p.episode.id],
  );

  return (
    <div className="wc-watch">
      {p.episode.allowed && p.story ? (
        <StoryPlayer
          story={p.story}
          style={p.style}
          characters={p.characters}
          locale={p.locale}
          startAt={p.resumeAt}
          flags={p.flags}
          isPaid={(s, c) => bought.current.has(choiceKey(p.episode.id, s.id, c.id))}
          onChoice={(s, c) => onChoice(s.id, c.id)}
          onScene={(s, h) => save(s.id, h)}
          onEnd={(s, ending, h) => save(s.id, h, true, ending)}
          onNextEpisode={p.hasNext ? () => router.push(`/watch/${p.seriesCode}/${p.episode.number + 1}`) : null}
          storeHref={`/store?back=${encodeURIComponent(here)}`}
        />
      ) : (
        <>
          {p.posterUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="wc-slide-poster" src={p.posterUrl} alt="" style={{ filter: "blur(6px) brightness(0.6)" }} />
          )}
          {p.episode.allowed && <div className="wc-slide-note">{t.soon}</div>}
        </>
      )}

      <div className="wc-watch-top" style={{ pointerEvents: "none" }}>
        <a href={`/series/${p.seriesCode}`} className="wc-glass" style={{ pointerEvents: "auto" }}>
          <span aria-hidden="true" style={{ display: "inline-block", transform: p.locale === "ar" ? "scaleX(-1)" : undefined }}>
            ‹
          </span>
          {t.episodes}
        </a>
        <span className="wc-glass" style={{ fontSize: 13, maxWidth: "45%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {p.title} · {t.episode(p.episode.number, p.total)}
        </span>
        <a href={`/store?back=${encodeURIComponent(here)}`} className="wc-glass" style={{ pointerEvents: "auto" }}>
          <PingIcon size={20} />
          {balance}
        </a>
      </div>

      {!p.episode.allowed && (
        <div className="wc-watch-sheet" style={{ background: "transparent", pointerEvents: "none" }}>
          <div style={{ pointerEvents: "auto", width: "100%" }}>
            <Paywall
              locale={p.locale}
              episodeId={p.episode.id}
              price={p.episode.price}
              balance={balance}
              trusted={p.trusted}
              seriesCode={p.seriesCode}
              seriesId={p.seriesId}
              seasonPassLabel={p.seasonPassLabel}
              weeklyPassLabel={p.weeklyPassLabel}
              returnTo={here}
            />
          </div>
        </div>
      )}
    </div>
  );
}
