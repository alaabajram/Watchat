// OpenArt credit budget for the Studio. Claude asks (reserve_credits) before every generation; the label's
// monthly allowance and a per-episode cap decide. Estimates come from OpenArt's own rates (Nov 2026) and are
// never lower than what Claude says the generation costs. Pure.

/** Credits per image, or per second of video, for the models the Studio prompt uses. */
export const MODEL_RATES: Record<string, { kind: "image" | "video"; credits: number; label: string }> = {
  "nano-banana-pro": { kind: "image", credits: 40, label: "Nano Banana Pro (1K–2K)" },
  "nano-banana-2": { kind: "image", credits: 20, label: "Nano Banana 2 (1K)" },
  "gpt-image-2": { kind: "image", credits: 20, label: "GPT Image 2" },
  "seedream-5": { kind: "image", credits: 30, label: "Seedream 5" },
  "kling-3": { kind: "video", credits: 35, label: "Kling 3.0, 720p with audio (per second)" },
  "seedance-2": { kind: "video", credits: 80, label: "Seedance 2.0, 720p (per second)" },
  "seedance-2.5": { kind: "video", credits: 130, label: "Seedance 2.5, 720p (per second)" },
};

export const MAX_COUNT = 12;
export const MAX_VIDEO_SECONDS = 15;

/**
 * Sound: credits per second by what it is (OpenArt's audio models vary, so the team sets these in Admin → Studio
 * from the rates OpenArt shows; these are starting values). Lip-sync is priced like a short video.
 */
export type AudioKind = "music" | "sfx" | "voice" | "lipsync";
export const AUDIO_KINDS: AudioKind[] = ["music", "sfx", "voice", "lipsync"];
export const AUDIO_RATES: Record<AudioKind, { credits: number; maxSeconds: number; label: string }> = {
  music: { credits: 4, maxSeconds: 180, label: "Music (per second)" },
  sfx: { credits: 3, maxSeconds: 15, label: "Sound effect (per second)" },
  voice: { credits: 2, maxSeconds: 30, label: "Voice line (per second)" },
  lipsync: { credits: 35, maxSeconds: 15, label: "Lip-sync clip (per second)" },
};

/** The team's audio rates over the starting values (only positive numbers count). */
export function audioRates(overrides: unknown): Record<AudioKind, number> {
  const o = overrides && typeof overrides === "object" ? (overrides as Record<string, unknown>) : {};
  return Object.fromEntries(
    AUDIO_KINDS.map((k) => {
      const n = Number(o[k]);
      return [k, Number.isFinite(n) && n > 0 ? Math.min(10000, Math.round(n * 100) / 100) : AUDIO_RATES[k].credits];
    }),
  ) as Record<AudioKind, number>;
}

/** "Nano Banana Pro" / "nano_banana_pro" / "kling 3.0" → a key of MODEL_RATES (or the cleaned name). */
export function modelKey(name: string): string {
  const k = name
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/\.0\b/g, "")
    .replace(/[^a-z0-9.-]/g, "");
  if (MODEL_RATES[k]) return k;
  const hit = Object.keys(MODEL_RATES).find((m) => k.startsWith(m));
  return hit ?? k.slice(0, 40);
}

export type CreditAsk = { model: string; kind: "image" | "video" | "audio"; audioKind?: AudioKind; count: number; seconds?: number; credits?: number };

/** Credits for a planned generation, or an error when it can't be estimated. `rates`: the team's audio rates. */
export function estimateCredits(a: CreditAsk, rates: Record<AudioKind, number> = audioRates({})): { credits: number; model: string } | { error: string } {
  const count = Math.round(a.count);
  if (!Number.isFinite(count) || count < 1 || count > MAX_COUNT) return { error: `count must be 1–${MAX_COUNT} per request.` };
  if (a.kind === "audio") {
    const k = a.audioKind;
    if (!k || !AUDIO_KINDS.includes(k)) return { error: `audio_kind must be one of ${AUDIO_KINDS.join(", ")}.` };
    const s = Math.round(Number(a.seconds) || 0);
    const max = AUDIO_RATES[k].maxSeconds;
    if (s < 1 || s > max) return { error: `seconds must be 1–${max} for ${k}.` };
    const claimed = Math.max(0, Math.round(Number(a.credits) || 0));
    return { credits: Math.max(Math.ceil(rates[k] * s * count), claimed), model: `${modelKey(a.model || k)}` };
  }
  const model = modelKey(a.model);
  const rate = MODEL_RATES[model];
  const claimed = Math.max(0, Math.round(Number(a.credits) || 0));
  let table = 0;
  if (rate) {
    if (rate.kind !== a.kind) return { error: `${rate.label} makes ${rate.kind}s, not ${a.kind}s.` };
    if (a.kind === "video") {
      const s = Math.round(Number(a.seconds) || 0);
      if (s < 1 || s > MAX_VIDEO_SECONDS) return { error: `seconds must be 1–${MAX_VIDEO_SECONDS} for a clip.` };
      table = rate.credits * s * count;
    } else table = rate.credits * count;
  } else if (!claimed) {
    return { error: `Unknown model "${a.model}": pass "credits" with the cost OpenArt shows for it.` };
  }
  return { credits: Math.max(table, claimed), model };
}

export type BudgetState = { monthly: number; monthUsed: number; episodeCap: number; episodeUsed: number };

/** `cap`: what the second limit is ("This episode's" by default, or e.g. "This series' artwork"). */
export function checkBudget(b: BudgetState, want: number, cap = "This episode's"): { ok: true; monthLeft: number; episodeLeft: number } | { ok: false; reason: string; monthLeft: number; episodeLeft: number } {
  const monthLeft = Math.max(0, b.monthly - b.monthUsed);
  const episodeLeft = Math.max(0, b.episodeCap - b.episodeUsed);
  if (want > monthLeft) return { ok: false, reason: `Not enough credits left this month (${monthLeft} left, ${want} needed). Stop and tell the team.`, monthLeft, episodeLeft };
  if (want > episodeLeft) return { ok: false, reason: `${cap} credit cap is reached (${episodeLeft} left of ${b.episodeCap}, ${want} needed). Stop and tell the team.`, monthLeft, episodeLeft };
  return { ok: true, monthLeft: monthLeft - want, episodeLeft: episodeLeft - want };
}

/** First moment of the current month (UTC), for "used this month". */
export const monthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
