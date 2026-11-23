"use client";

// Plays one story episode, full screen in the 9:16 frame: tap to go on, pick at choices (premium ones cost Ping),
// sound and music, slow camera moves, typewriter text. Four looks: visual novel, chat story, motion comic, photo story.
// Used by the viewer's watch page and by the Story builder's preview (where nothing is paid or saved).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PingIcon } from "@/components/brand/PingIcon";
import { advance, sceneOf, startOf } from "@/lib/story/engine";
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
  const musicRef = useRef<HTMLAudioElement>(null);
  const voiceRef = useRef<HTMLAudioElement>(null);
  const musicSrc = useRef<string | null>(null);

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

  // Sound: the scene's voice / effect, and music that carries on until changed or stopped.
  useEffect(() => {
    if (!scene || !started) return;
    const voice = voiceRef.current;
    if (voice) {
      voice.pause();
      if (scene.audio?.url) {
        voice.src = scene.audio.url;
        void voice.play().catch(() => undefined);
      }
    }
    const music = musicRef.current;
    if (music) {
      if (scene.stopMusic) {
        music.pause();
        musicSrc.current = null;
      } else if (scene.music?.url && scene.music.url !== musicSrc.current) {
        musicSrc.current = scene.music.url;
        music.src = scene.music.url;
        music.volume = 0.45;
        void music.play().catch(() => undefined);
      }
    }
  }, [scene, started]);

  useEffect(
    () => () => {
      musicRef.current?.pause();
      voiceRef.current?.pause();
    },
    [],
  );

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

  // Moves on by itself after `auto` seconds (motion comics use this most).
  useEffect(() => {
    if (!scene || !started || ended || scene.route.type === "choices" || !scene.auto || !textDone) return;
    const id = window.setTimeout(goOn, scene.auto * 1000);
    return () => window.clearTimeout(id);
  }, [scene, started, ended, textDone, goOn]);

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
    <video key={scene.video.url} className="wc-story-media" src={scene.video.url} autoPlay={started} playsInline loop={!scene.auto} controlsList="nodownload" disablePictureInPicture onContextMenu={(e) => e.preventDefault()} />
  ) : scene.image ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img key={scene.image.url} className={`wc-story-media wc-motion-${scene.motion}`} src={scene.image.url} alt="" draggable={false} onContextMenu={(e) => e.preventDefault()} />
  ) : null;

  return (
    <div className={`wc-story wc-story-${p.style}`} dir={dir} onClick={started ? goOn : undefined}>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={musicRef} loop preload="auto" />
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={voiceRef} preload="auto" />

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
