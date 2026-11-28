"use client";

// A hero's voice note: tap to play / stop; shows its length once the file's details have loaded.

import { useRef, useState } from "react";

export function VoiceChip({ src, label, emoji = "🎙️" }: { src: string; label: string; emoji?: string }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [length, setLength] = useState<string | null>(null);
  const toggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const a = audio.current;
    if (!a) return;
    if (a.paused) {
      document.querySelectorAll<HTMLAudioElement>("audio[data-hero-voice]").forEach((o) => o !== a && o.pause());
      void a.play().catch(() => setPlaying(false));
    } else a.pause();
  };
  return (
    <button type="button" className="hr-chip" onClick={toggle} aria-pressed={playing}>
      <span aria-hidden="true">{playing ? "⏸" : emoji}</span>
      {length ? <b dir="ltr">{length}</b> : null}
      <span>{label}</span>
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        data-hero-voice=""
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d)) setLength(`${Math.floor(d / 60)}:${String(Math.round(d % 60)).padStart(2, "0")}`);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
    </button>
  );
}
