// How rooms look on the Rooms page (pure): default button and crowd words per mechanic, the countdown to the
// next round (Gulf midnight) and the weekly jackpot winners.

import type { Mechanic } from "./engine";

type L = { ar: string; en: string };

/** Default button per mechanic when the room has none of its own. */
export const DEFAULT_CTA: Record<Mechanic, L> = {
  poll: { ar: "صوّت", en: "Vote" },
  would_you_rather: { ar: "العب", en: "Play" },
  opinion: { ar: "ناقش", en: "Debate" },
  hot_seat: { ar: "اجلس على الكرسي", en: "Enter seat" },
  liar: { ar: "اكشف الكذبة", en: "Spot lie" },
  guess: { ar: "حلّها", en: "Solve" },
  debate: { ar: "انضم للحلبة", en: "Join fight" },
};

/** What the crowd is doing, next to the count ("840 voting"). */
export const CROWD_WORD: Record<Mechanic, L> = {
  poll: { ar: "يصوّتون", en: "voting" },
  would_you_rather: { ar: "يصوّتون", en: "voting" },
  opinion: { ar: "يتناقشون", en: "debating" },
  hot_seat: { ar: "يسألون", en: "asking" },
  liar: { ar: "محققين", en: "detectives" },
  guess: { ar: "يحلّون", en: "solving" },
  debate: { ar: "يتنافسون", en: "fighting" },
};

/** Seconds until the next Gulf midnight (UTC+4, no daylight saving), when every room flips to its next round. */
export function secondsToNextRound(now: Date = new Date()): number {
  const gulf = now.getTime() + 4 * 3600_000;
  const dayMs = 86_400_000;
  return Math.ceil((dayMs - (gulf % dayMs)) / 1000);
}

export function hms(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

/** Everyone tied for the week's top score wins the jackpot (no one when nobody scored; at most `max`). */
export function weeklyWinners(scores: Map<string, number>, max = 50): string[] {
  const top = Math.max(0, ...scores.values());
  if (top <= 0) return [];
  const tied = [...scores.entries()].filter(([, n]) => n === top).map(([id]) => id);
  return tied.length <= max ? tied.sort() : [];
}
