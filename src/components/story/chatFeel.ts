// Story "feel": tiny message sounds and haptics, so every story series feels like a chat app.
// - Sounds are made in code with Web Audio (no files to make or load, nothing to pay for): a soft pop for an
//   incoming bubble, a brighter blip for the viewer's own side, a quieter tick for narration, a light "tk-tk"
//   when typing starts, and a "sent" whoosh when the viewer taps a choice. Kept well under the story's music.
// - Haptics: inside Telegram through its own HapticFeedback (iPhone and Android); elsewhere navigator.vibrate,
//   which Android browsers honour and iPhones ignore (websites can't vibrate an iPhone).
// - The player's mute button silences both. Browsers only allow sound after a tap: `unlock()` runs on the
//   start tap.

export type ChatCue = "incoming" | "mine" | "note" | "typing" | "sent";

type Haptics = {
  impactOccurred?: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
  notificationOccurred?: (type: "error" | "success" | "warning") => void;
  selectionChanged?: () => void;
};

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  return ctx;
}

/** Call from the viewer's first tap so later sounds are allowed. */
export const unlock = () => void audio();

const VOL = 0.11;

/** One short tone: frequency glide `from` → `to` over `ms`, soft attack and quick fade. */
function tone(ac: AudioContext, at: number, from: number, to: number, ms: number, vol = VOL, type: OscillatorType = "sine") {
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(from, at);
  o.frequency.exponentialRampToValueAtTime(to, at + ms / 1000);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, at + ms / 1000);
  o.connect(g).connect(ac.destination);
  o.start(at);
  o.stop(at + ms / 1000 + 0.02);
}

/** The "sent" whoosh: a band of noise sweeping up, then a small confirming tick. */
function whoosh(ac: AudioContext, at: number) {
  const len = 0.22;
  const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * len), ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const bp = ac.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 1.4;
  bp.frequency.setValueAtTime(700, at);
  bp.frequency.exponentialRampToValueAtTime(3800, at + len);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(VOL * 0.9, at + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  src.connect(bp).connect(g).connect(ac.destination);
  src.start(at);
  src.stop(at + len + 0.02);
  tone(ac, at + len - 0.03, 1500, 2100, 70, VOL * 0.7);
}

function haptic(cue: ChatCue) {
  if (typeof window === "undefined") return;
  const tg = (window as unknown as { Telegram?: { WebApp?: { HapticFeedback?: Haptics; isVersionAtLeast?: (v: string) => boolean } } }).Telegram?.WebApp;
  if (tg?.HapticFeedback && (tg.isVersionAtLeast?.("6.1") ?? true)) {
    try {
      if (cue === "sent") tg.HapticFeedback.impactOccurred?.("medium");
      else if (cue === "typing") tg.HapticFeedback.selectionChanged?.();
      else tg.HapticFeedback.impactOccurred?.(cue === "note" ? "soft" : "light");
      return;
    } catch {
      /* fall through to vibrate */
    }
  }
  if (cue === "typing" || cue === "note") return; // too fussy as a vibration
  try {
    navigator.vibrate?.(cue === "sent" ? 22 : 10);
  } catch {
    /* not allowed (no tap yet) or not supported */
  }
}

/** Play a chat cue (sound + haptic) unless the viewer muted the story. */
export function chatCue(cue: ChatCue, muted: boolean) {
  if (muted) return;
  haptic(cue);
  const ac = audio();
  if (!ac || ac.state !== "running") return;
  const t = ac.currentTime + 0.01;
  switch (cue) {
    case "incoming":
      tone(ac, t, 620, 940, 110);
      break;
    case "mine":
      tone(ac, t, 880, 1320, 70, VOL * 0.8);
      tone(ac, t + 0.06, 1320, 1560, 60, VOL * 0.6);
      break;
    case "note":
      tone(ac, t, 520, 600, 90, VOL * 0.5, "triangle");
      break;
    case "typing":
      tone(ac, t, 1900, 1800, 25, VOL * 0.35, "triangle");
      tone(ac, t + 0.09, 1900, 1800, 25, VOL * 0.3, "triangle");
      break;
    case "sent":
      whoosh(ac, t);
      break;
  }
}
