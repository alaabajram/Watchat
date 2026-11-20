// CTR meters: is a sequence, campaign or flow card working? Pure (no database).
//
// Sequences and campaigns: CTR = viewers who opened the template's link ÷ messages delivered.
// Flow cards: CTR = viewers who tapped a button or opened the link ÷ viewers who got the card.
// Below a minimum sample the verdict is "too early", so one quiet day doesn't flag a card.

/** What sent a message or a link, for click tracking. */
export type MsgRef = { type: "sequence" | "campaign" | "flow" | "growth"; id: string; node?: string };

export type Health = "good" | "ok" | "low" | "early" | "none";

export const CTR_RULES = {
  // Template reminders: a link click from a marketing message.
  message: { minSample: 30, good: 0.15, ok: 0.07 },
  // Chat cards: a button tap or link open in a conversation the viewer started.
  card: { minSample: 20, good: 0.4, ok: 0.2 },
} as const;

export function ctr(clicks: number, base: number): number | null {
  return base > 0 ? Math.min(1, clicks / base) : null;
}

export function health(clicks: number, base: number, kind: keyof typeof CTR_RULES): Health {
  const r = CTR_RULES[kind];
  if (base <= 0) return "none";
  if (base < r.minSample) return "early";
  const v = clicks / base;
  return v >= r.good ? "good" : v >= r.ok ? "ok" : "low";
}

export const HEALTH_LABEL: Record<Health, string> = {
  good: "Working",
  ok: "Fair",
  low: "Not working: pause or edit",
  early: "Too early to tell",
  none: "No sends yet",
};

export const HEALTH_COLOR: Record<Health, string> = {
  good: "#16a34a",
  ok: "#d97706",
  low: "#dc2626",
  early: "#6b7280",
  none: "#9ca3af",
};

/** Cards whose messages carry something to tap or open; others (text, waits, conditions) have no CTR. */
export const CLICKABLE_KINDS = new Set(["language", "message", "episode", "link", "optin", "choice", "template"]);

export type CardStat = { reached: number; clicked: number };

/** Whole-flow CTR over its clickable cards, and the weakest card with enough sample. */
export function flowSummary(stats: Record<string, CardStat>, kinds: Record<string, string>): { reached: number; clicked: number; weakest: string | null } {
  let reached = 0;
  let clicked = 0;
  let weakest: string | null = null;
  let weakestRate = Infinity;
  for (const [node, s] of Object.entries(stats)) {
    if (!CLICKABLE_KINDS.has(kinds[node] ?? "")) continue;
    reached += s.reached;
    clicked += s.clicked;
    if (s.reached >= CTR_RULES.card.minSample) {
      const rate = s.clicked / s.reached;
      if (rate < weakestRate) {
        weakestRate = rate;
        weakest = node;
      }
    }
  }
  return { reached, clicked, weakest };
}
