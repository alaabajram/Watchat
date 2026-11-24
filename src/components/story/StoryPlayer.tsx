"use client";

// Plays one story episode, full screen in the 9:16 frame: tap to go on, pick at choices (premium ones cost Ping),
// sound, slow camera moves, typewriter text. Four looks: visual novel, chat story, motion comic, photo story.
// Sound: a music bed that loops across scenes and crossfades (~800 ms) when it changes, ducks about 10 dB under a
// voice line, up to 2 effects when a scene opens, and the speaker's voice (auto-advance waits for it). Nothing plays
// before the viewer's first tap (browser rules); the mute button is remembered on the device. iPhones ignore
// volume changes on audio elements, so there the bed plays without fades or ducking.
// Used by the viewer's watch page and by the Story builder's preview (where nothing is paid or saved).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PingIcon } from "@/components/brand/PingIcon";
import { advance, audioPlan, musicOf, sceneOf, startOf } from "@/lib/story/engine";
import type { Bi, Character, Choice, Scene, StoryGraph, StoryStyle } from "@/lib/story/types";

type Locale = "ar" | "en";

const COPY = {
  ar: {
    tapToStart: "اضغط للبدء",
    tapToContinue: "اضغط للمتابعة",
    end: "نهاية الحلقة",
    endingReached: (name: string) => `وصلت إلى: ${name}`,
    next: "الحلقة التالية",
    replay: "إعادة من البداية",
    back: "رجوع",
    narrator: "الراوي",
    typing: "يكتب…",
    paying: "لحظة…",
    notEnough: "رصيد البينج لا يكفي.",
    getPing: "احصل على بينج",
    error: "حدث خطأ، حاول مرة أخرى.",
    premiumNote: "خيار مميز: يُدفع مرة واحدة",
    muted: "الصوت مغلق",
    mute: "كتم الصوت",
    unmute: "تشغيل الصوت",
  },
  en: {
    tapToStart: "Tap to start",
    tapToContinue: "Tap to continue",
    end: "End of the episode",
    endingReached: (name: string) => `You reached: ${name}`,
    next: "Next episode",
    replay: "Play again from the start",
    back: "Back",
    narrator: "Narrator",
    typing: "typing…",
    paying: "One moment…",
    notEnough: "Not enough Ping.",
    getPing: "Get Ping",
    error: "Something went wrong. Try again.",
    premiumNote: "Premium choice: pay once",
    muted: "Sound off",
    mute: "Mute",
    unmute: "Sound on",
  },
} as const;

export type ChoiceResult = "ok" | "insufficient" | "error";

export type StoryPlayerProps = {
  story: StoryGraph;
  style: StoryStyle;
  characters: Character[];
  locale: Locale;
  /** Resume at this scene (if it still exists). */
  startAt?: string | null;
  /** Flags set by earlier choices in this series. */
  flags?: string[];
  /** Is this premium choice already paid (replays are free)? */
  isPaid?: (scene: Scene, choice: Choice) => boolean;
  /** Record a choice (and pay for a premium one). The preview resolves "ok" straight away. */
  onChoice?: (scene: Scene, choice: Choice) => Promise<ChoiceResult>;
  /** A scene was shown (save the place). */
  onScene?: (scene: Scene, history: string[]) => void;
  /** The episode ended (`ending` is the ending scene's id when it is a named ending). */
  onEnd?: (scene: Scene, ending: string | null, history: string[]) => void;
  /** Shown on the end card when there's a next episode. */
  onNextEpisode?: (() => void) | null;
  /** Where "Get Ping" goes when a premium choice can't be paid. */
  storeHref?: string;
  /** Builder preview: no "tap to start" screen, sounds start on the first tap anyway. */
  preview?: boolean;
  /** Jump to this scene (builder: "preview from here"). Changing it restarts there. */
  jumpTo?: string | null;
};

const pick = (b: Bi, locale: Locale) => (locale === "en" ? b.en || b.ar : b.ar || b.en);

const MUSIC_VOL = 0.45;
const DUCKED = MUSIC_VOL * 0.316; // −10 dB under a voice line
const CROSSFADE_MS = 800;
const MUTE_KEY = "wc-story-muted";

/** Smoothly move an element's volume (cancels its previous fade). */
function ramp(el: HTMLAudioElement, to: number, ms: number, timers: Map<HTMLAudioElement, number>, then?: () => void) {
  const prev = timers.get(el);
  if (prev) window.clearInterval(prev);
  const from = el.volume;
  const steps = Math.max(1, Math.round(ms / 40));
  let i = 0;
  const id = window.setInterval(() => {
    i++;
    try {
      el.volume = Math.min(1, Math.max(0, from + ((to - from) * i) / steps));
    } catch {
      /* some browsers refuse volume changes */
    }
    if (i >= steps) {
      window.clearInterval(id);
      timers.delete(el);
      then?.();
    }
  }, 40);
  timers.set(el, id);
}

export function StoryPlayer(p: StoryPlayerProps) {
  const t = COPY[p.locale];
  const dir = p.locale === "ar" ? "rtl" : "ltr";
  const people = useMemo(() => new Map(p.characters.map((c) => [c.id, c])), [p.characters]);
  const first = useMemo(() => startOf(p.story, p.jumpTo ?? p.startAt), [p.story, p.jumpTo, p.startAt]);

  const [started, setStarted] = useState(Boolean(p.preview));
  const [sceneId, setSceneId] = useState<string | null>(first?.id ?? null);
  const [history, setHistory] = useState<string[]>(first ? [first.id] : []);
  const [flags, setFlags] = useState<Set<string>>(() => new Set(p.flags ?? []));
  const [ended, setEnded] = useState<{ ending: string | null } | null>(null);
  const [typed, setTyped] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; store?: boolean } | null>(null);
  const [paidNow, setPaidNow] = useState<Set<string>>(() => new Set());
  const musicA = useRef<HTMLAudioElement>(null);
  const musicB = useRef<HTMLAudioElement>(null);
  const voiceRef = useRef<HTMLAudioElement>(null);
  const sfxA = useRef<HTMLAudioElement>(null);
  const sfxB = useRef<HTMLAudioElement>(null);
  const musicOn = useRef<"a" | "b">("a");
  const musicSrc = useRef<string | null>(null);
  const voicePlaying = useRef(false);
  const fades = useRef(new Map<HTMLAudioElement, number>());
  const [voiceDone, setVoiceDone] = useState(true);
  const [muted, setMuted] = useState(false);
  const hasSound = useMemo(() => p.story.scenes.some((s) => s.audio || s.music || s.video) || audioPlan(p.story).some((a) => a.media), [p.story]);

  // The mute choice is remembered on this device.
  useEffect(() => {
    try {
      setMuted(window.localStorage.getItem(MUTE_KEY) === "1");
    } catch {
      /* storage blocked (private mode, framed): start with sound */
    }
  }, []);
  useEffect(() => {
    for (const r of [musicA, musicB, voiceRef, sfxA, sfxB]) if (r.current) r.current.muted = muted;
  }, [muted]);
  const toggleMute = () =>
    setMuted((m) => {
      try {
        window.localStorage.setItem(MUTE_KEY, m ? "0" : "1");
      } catch {
        /* not remembered, still toggled */
      }
      return !m;
    });

  // Builder: restart when the story or the "preview from" scene changes.
  useEffect(() => {
    if (!p.preview) return;
    const s = startOf(p.story, p.jumpTo);
    setSceneId(s?.id ?? null);
    setHistory(s ? [s.id] : []);
    setEnded(null);
    setFlags(new Set(p.flags ?? []));
    setMessage(null);
  }, [p.preview, p.story, p.jumpTo, p.flags]);

  const scene = sceneOf(p.story, sceneId);
  const text = scene ? pick(scene.text, p.locale) : "";
  const textDone = typed >= text.length;

  // Typewriter (chat stories show whole messages after a short "typing…").
  useEffect(() => {
    setTyped(0);
    if (!scene || !started) return;
    const full = pick(scene.text, p.locale);
    if (p.style === "chat") {
      const id = window.setTimeout(() => setTyped(full.length), Math.min(1600, 450 + full.length * 18));
      return () => window.clearTimeout(id);
    }
    let n = 0;
    const id = window.setInterval(() => {
      n += 2;
      setTyped(Math.min(n, full.length));
      if (n >= full.length) window.clearInterval(id);
    }, 28);
    return () => window.clearInterval(id);
  }, [scene, started, p.locale, p.style]);

  // Sound for the scene: the music bed (carries on until another bed starts or a scene stops it), its effects and
  // the speaker's voice line.
  useEffect(() => {
    if (!scene || !started) return;
    const timers = fades.current;
    // The last scene's voice stops first, so the music isn't left ducked.
    const voice = voiceRef.current;
    voice?.pause();
    voicePlaying.current = false;
    const current = musicOn.current === "a" ? musicA.current : musicB.current;
    const other = musicOn.current === "a" ? musicB.current : musicA.current;
    const bed = musicOf(p.story, scene);
    if (scene.stopMusic && current && musicSrc.current) {
      musicSrc.current = null;
      ramp(current, 0, CROSSFADE_MS, timers, () => current.pause());
    } else if (bed?.url && bed.url !== musicSrc.current && current && other) {
      // Crossfade: the new bed rises on the other element while the old one fades out.
      musicSrc.current = bed.url;
      other.src = bed.url;
      other.volume = 0;
      void other.play().catch(() => undefined);
      ramp(other, voicePlaying.current ? DUCKED : MUSIC_VOL, CROSSFADE_MS, timers);
      if (!current.paused) ramp(current, 0, CROSSFADE_MS, timers, () => current.pause());
      musicOn.current = musicOn.current === "a" ? "b" : "a";
    } else if (current && !current.paused && musicSrc.current) ramp(current, MUSIC_VOL, 250, timers);

    [sfxA.current, sfxB.current].forEach((el, i) => {
      if (!el) return;
      el.pause();
      const fx = (scene.sfx ?? [])[i]?.media;
      if (fx?.url) {
        el.src = fx.url;
        el.currentTime = 0;
        void el.play().catch(() => undefined);
      }
    });

    if (voice) {
      if (scene.audio?.url) {
        voice.src = scene.audio.url;
        setVoiceDone(false);
        void voice.play().catch(() => setVoiceDone(true));
      } else setVoiceDone(true);
    }
  }, [scene, started, p.story]);

  // Duck the music while a voice line plays.
  const duck = (on: boolean) => {
    voicePlaying.current = on;
    const bed = musicOn.current === "a" ? musicA.current : musicB.current;
    if (bed && !bed.paused) ramp(bed, on ? DUCKED : MUSIC_VOL, 250, fades.current);
  };

  useEffect(() => {
    const timers = fades.current;
    const els = [musicA, musicB, voiceRef, sfxA, sfxB];
    return () => {
      timers.forEach((id) => window.clearInterval(id));
      for (const r of els) r.current?.pause();
    };
  }, []);

  const show = useCallback(
    (next: Scene, setFlag: string | null) => {
      if (setFlag) setFlags((f) => new Set(f).add(setFlag));
      const nh = [...history, next.id].slice(-300);
      setSceneId(next.id);
      setHistory(nh);
      p.onScene?.(next, nh);
      setMessage(null);
    },
    [p, history],
  );

  const finish = useCallback(
    (from: Scene, ending: string | null) => {
      setEnded({ ending });
      p.onEnd?.(from, ending, history);
    },
    [p, history],
  );

  const goOn = useCallback(() => {
    if (!scene || ended) return;
    if (!textDone) return setTyped(text.length);
    if (scene.route.type === "choices") return;
    const step = advance(p.story, scene, { flags });
    if (step.kind === "scene") show(step.scene, step.setFlag);
    else if (step.kind === "end") finish(scene, step.ending);
  }, [scene, ended, textDone, text.length, p.story, flags, show, finish]);

  // Moves on by itself after `auto` seconds (motion comics use this most), once the voice line has finished.
  useEffect(() => {
    if (!scene || !started || ended || scene.route.type === "choices" || !scene.auto || !textDone || !voiceDone) return;
    const id = window.setTimeout(goOn, scene.auto * 1000);
    return () => window.clearTimeout(id);
  }, [scene, started, ended, textDone, voiceDone, goOn]);

  const choose = useCallback(
    async (c: Choice) => {
      if (!scene || busy) return;
      const already = c.price === 0 || paidNow.has(c.id + scene.id) || (p.isPaid?.(scene, c) ?? false);
      setBusy(true);
      setMessage(null);
      const res = p.onChoice ? await p.onChoice(scene, c).catch((): ChoiceResult => "error") : "ok";
      setBusy(false);
      if (res === "insufficient") return setMessage({ text: t.notEnough, store: true });
      if (res === "error") return setMessage({ text: t.error });
      if (!already) setPaidNow((s) => new Set(s).add(c.id + scene.id));
      const step = advance(p.story, scene, { choiceId: c.id, flags, paid: () => true });
      if (step.kind === "scene") show(step.scene, step.setFlag);
      else if (step.kind === "end") {
        if (step.setFlag) setFlags((f) => new Set(f).add(step.setFlag!));
        finish(scene, step.ending);
      }
    },
    [scene, busy, paidNow, p, t, flags, show, finish],
  );

  const restart = () => {
    const s = startOf(p.story);
    setEnded(null);
    setSceneId(s?.id ?? null);
    setHistory(s ? [s.id] : []);
    setMessage(null);
  };

  if (!scene) return <div className="wc-story-empty">{t.end}</div>;

  const speaker = scene.speaker ? people.get(scene.speaker) : null;
  const choices = scene.route.type === "choices" && textDone && !ended ? scene.route.options : [];
  const media = scene.video ? (
    <video key={scene.video.url} className="wc-story-media" src={scene.video.url} autoPlay={started} muted={muted} playsInline loop={!scene.auto} controlsList="nodownload" disablePictureInPicture onContextMenu={(e) => e.preventDefault()} />
  ) : scene.image ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img key={scene.image.url} className={`wc-story-media wc-motion-${scene.motion}`} src={scene.image.url} alt="" draggable={false} onContextMenu={(e) => e.preventDefault()} />
  ) : null;

  return (
    <div className={`wc-story wc-story-${p.style}`} dir={dir} onClick={started ? goOn : undefined}>
      {/* Sound never carries words that aren't on screen too (the text is always shown), so no captions track. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={musicA} loop preload="auto" />
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={musicB} loop preload="auto" />
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={voiceRef}
        preload="auto"
        onPlay={() => duck(true)}
        onEnded={() => {
          duck(false);
          setVoiceDone(true);
        }}
        onError={() => {
          duck(false);
          setVoiceDone(true);
        }}
      />
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={sfxA} preload="auto" />
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={sfxB} preload="auto" />
      {hasSound && started && (
        <button
          type="button"
          className="wc-story-mute"
          aria-pressed={muted}
          aria-label={muted ? t.unmute : t.mute}
          title={muted ? t.unmute : t.mute}
          onClick={(e) => {
            e.stopPropagation();
            toggleMute();
          }}
        >
          {muted ? "🔇" : "🔊"}
        </button>
      )}

      {p.style === "chat" ? (
        <ChatThread story={p.story} history={history} current={scene} typed={textDone} people={people} locale={p.locale} typingLabel={t.typing} />
      ) : (
        <div className="wc-story-stage">{media}</div>
      )}

      {/* Bottom: the choices (when it's time to choose) above the line of text. */}
      <div className="wc-story-bottom">
        {choices.length > 0 && (
          <div className="wc-story-choices" onClick={(e) => e.stopPropagation()}>
            {choices.map((c) => {
              const paid = c.price === 0 || paidNow.has(c.id + scene.id) || (p.isPaid?.(scene, c) ?? false);
              return (
                <button key={c.id} type="button" className={`wc-story-choice${c.price > 0 ? " premium" : ""}`} disabled={busy} onClick={() => void choose(c)}>
                  <span>{pick(c.label, p.locale)}</span>
                  {c.price > 0 && !paid && (
                    <span className="wc-story-price" title={t.premiumNote}>
                      <PingIcon size={16} /> {c.price}
                    </span>
                  )}
                </button>
              );
            })}
            {busy && <span className="wc-story-note">{t.paying}</span>}
            {message && (
              <span className="wc-story-note">
                {message.text}{" "}
                {message.store && p.storeHref && (
                  <a href={p.storeHref} className="wc-story-link">
                    {t.getPing}
                  </a>
                )}
              </span>
            )}
          </div>
        )}
        {p.style !== "chat" && text && (
          <div className={p.style === "photo" ? "wc-story-caption" : "wc-story-box"}>
            {p.style !== "photo" && (
              <span className="wc-story-speaker" data-narrator={speaker ? undefined : ""} style={{ background: speaker?.color ?? "rgba(255,255,255,.18)" }}>
                {speaker ? pick(speaker.name, p.locale) : t.narrator}
              </span>
            )}
            <p>
              {text.slice(0, typed)}
              <span style={{ opacity: 0 }}>{text.slice(typed)}</span>
            </p>
          </div>
        )}
      </div>

      {!choices.length && !ended && started && textDone && scene.route.type !== "choices" && !scene.auto && <span className="wc-story-tap" aria-hidden="true">{t.tapToContinue} ›</span>}

      {ended && (
        <div className="wc-story-end" onClick={(e) => e.stopPropagation()}>
          <strong>{t.end}</strong>
          {ended.ending && scene.route.type === "end" && scene.route.ending && <span>{t.endingReached(pick(scene.route.ending, p.locale))}</span>}
          {p.onNextEpisode && (
            <button type="button" className="wc-btn" onClick={p.onNextEpisode}>
              {t.next}
            </button>
          )}
          <button type="button" className="wc-btn wc-btn-ghost" onClick={restart}>
            {t.replay}
          </button>
        </div>
      )}

      {!started && (
        <button
          type="button"
          className="wc-story-start"
          onClick={(e) => {
            e.stopPropagation();
            setStarted(true);
            p.onScene?.(scene, history);
          }}
        >
          <span className="wc-play-btn" style={{ position: "static", transform: "none", display: "grid", placeItems: "center" }} aria-hidden="true">
            ▶
          </span>
          {t.tapToStart}
        </button>
      )}
    </div>
  );
}

/** Chat story: the scenes seen so far as a message thread (the phone owner on the end side), newest at the bottom. */
function ChatThread(p: { story: StoryGraph; history: string[]; current: Scene; typed: boolean; people: Map<string, Character>; locale: Locale; typingLabel: string }) {
  const end = useRef<HTMLDivElement>(null);
  const shown = p.history.map((id) => sceneOf(p.story, id)).filter((s): s is Scene => Boolean(s));
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [p.history.length, p.typed]);
  return (
    <div className="wc-chat">
      {shown.map((s, i) => {
        const last = i === shown.length - 1;
        const who = s.speaker ? p.people.get(s.speaker) : null;
        const mine = Boolean(who?.owner);
        const body = pick(s.text, p.locale);
        if (!who && !s.image && !s.video) return body ? <div key={`${s.id}-${i}`} className="wc-chat-note">{body}</div> : null;
        if (last && !p.typed && body)
          return (
            <div key={`${s.id}-${i}`} className={`wc-chat-row${mine ? " mine" : ""}`}>
              <span className="wc-chat-bubble wc-chat-typing">{p.typingLabel}</span>
            </div>
          );
        return (
          <div key={`${s.id}-${i}`} className={`wc-chat-row${mine ? " mine" : ""}`}>
            {!mine && who?.avatar?.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="wc-chat-avatar" src={who.avatar.url} alt="" />
            ) : !mine ? (
              <span className="wc-chat-avatar" style={{ background: who?.color ?? "#555" }}>
                {who ? pick(who.name, p.locale).slice(0, 1) : ""}
              </span>
            ) : null}
            <span className="wc-chat-bubble">
              {!mine && who && <b style={{ color: who.color }}>{pick(who.name, p.locale)}</b>}
              {s.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.image.url} alt="" draggable={false} />
              )}
              {s.video && <video src={s.video.url} playsInline autoPlay={last} muted={!last} loop controlsList="nodownload" />}
              {body && <span>{body}</span>}
            </span>
          </div>
        );
      })}
      <div ref={end} />
    </div>
  );
}
