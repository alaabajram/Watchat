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

export type CreditAsk = { model: string; kind: "image" | "video"; count: number; seconds?: number; credits?: number };

/** Credits for a planned generation, or an error when it can't be estimated. */
export function estimateCredits(a: CreditAsk): { credits: number; model: string } | { error: string } {
  const count = Math.round(a.count);
  if (!Number.isFinite(count) || count < 1 || count > MAX_COUNT) return { error: `count must be 1–${MAX_COUNT} per request.` };
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

export function checkBudget(b: BudgetState, want: number): { ok: true; monthLeft: number; episodeLeft: number } | { ok: false; reason: string; monthLeft: number; episodeLeft: number } {
  const monthLeft = Math.max(0, b.monthly - b.monthUsed);
  const episodeLeft = Math.max(0, b.episodeCap - b.episodeUsed);
  if (want > monthLeft) return { ok: false, reason: `Not enough credits left this month (${monthLeft} left, ${want} needed). Stop and tell the team.`, monthLeft, episodeLeft };
  if (want > episodeLeft) return { ok: false, reason: `This episode's credit cap is reached (${episodeLeft} left of ${b.episodeCap}, ${want} needed). Stop and tell the team.`, monthLeft, episodeLeft };
  return { ok: true, monthLeft: monthLeft - want, episodeLeft: episodeLeft - want };
}

/** First moment of the current month (UTC), for "used this month". */
export const monthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
