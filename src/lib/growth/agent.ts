// The growth agent's contract (pure, unit-tested): what it sees about each viewer, the only actions it
// may choose, how it learns from the team's reviews and from results, and the checks every decision
// passes before it reaches the review queue. No database or network here.

import type { Tool } from "../ai/anthropic";

export type SeriesActivity = {
  code: string;
  title: string;
  episodes: number;
  watchedUpTo: number; // furthest episode started (web) or sent (chat)
  finished: boolean;
  lastWatchedDaysAgo: number | null;
};

export type ViewerSummary = {
  ref: string; // "v1", "v2"… (no phone numbers or names go to the AI)
  language: "ar" | "en";
  country: string | null;
  daysSinceActive: number;
  paid: boolean;
  series: SeriesActivity[];
  recentMessages: { template: string; daysAgo: number; cameBack: boolean }[];
  pastSuggestions: { action: string; status: string; daysAgo: number; cameBack: boolean }[];
};

export type Catalog = {
  series: { code: string; title: string; episodes: number; freeUntil: number }[];
  templates: { name: string; category: string; body: string; quickReply: boolean }[]; // approved only
};

export type Learning = {
  reviews: { action: string; template: string | null; approved: boolean; note: string | null; reason: string }[];
  results: { key: string; sent: number; cameBack: number }[]; // per action/template
  holdout: { reviewed: number; cameBack: number };
};

export type GrowthAction = "none" | "template" | "series_picks" | "flag";
export type Decision = {
  ref: string;
  action: GrowthAction;
  template: string;
  series: string;
  episode: number;
  picks: string[];
  reason: string;
  priority: number;
};

export const PICKS_TEMPLATE = "series_picks";

export const GROWTH_TOOL: Tool = {
  name: "decide",
  description: "Decide the next step for each viewer. Exactly one decision per viewer.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["decisions"],
    properties: {
      decisions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["ref", "action", "template", "series", "episode", "picks", "reason", "priority"],
          properties: {
            ref: { type: "string", description: "The viewer's ref, e.g. v3." },
            action: {
              type: "string",
              enum: ["none", "template", "series_picks", "flag"],
              description:
                "none: leave them alone for now. template: send one approved template about one series. series_picks: send the series_picks template; tapping it shows 2–3 series you pick. flag: ask the team to look (something unusual).",
            },
            template: { type: "string", description: "template: the approved template name. Otherwise empty." },
            series: { type: "string", description: "template: the series code the message is about. Otherwise empty." },
            episode: { type: "integer", description: "template: the episode to bring them back to (usually the next unwatched one). Otherwise 0." },
            picks: { type: "array", items: { type: "string" }, description: "series_picks: 2–3 series codes, best first. Otherwise empty." },
            reason: { type: "string", description: "One short sentence in English for the team: why this, why now." },
            priority: { type: "integer", description: "1 = high value (hooked viewer slipping away), 2 = normal, 3 = low." },
          },
        },
      },
    },
  },
};

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "n/a");

export function growthSystemPrompt(catalog: Catalog, learning: Learning): string {
  const results = learning.results.length
    ? learning.results.map((r) => `- ${r.key}: ${r.sent} sent, ${pct(r.cameBack, r.sent)} came back within 3 days`).join("\n")
    : "- no results yet";
  const reviews = learning.reviews.length
    ? learning.reviews
        .slice(0, 30)
        .map((r) => `- ${r.approved ? "APPROVED" : "REJECTED"} ${r.action}${r.template ? ` (${r.template})` : ""}: "${r.reason}"${r.note ? ` · team note: "${r.note}"` : ""}`)
        .join("\n")
    : "- no reviews yet";
  return `You are Watchat's growth agent. Watchat is an Arabic-first micro-drama service: viewers start a series in WhatsApp,
then watch on the web; episodes after the free ones cost Ping (the viewer currency; new viewers get free Ping), or a weekly / yearly pass opens every series. Your job: bring viewers back to watch, finish series and pay,
without spamming. Every message costs about $0.066 and too many messages make people block the number, so "none" is often right.

Live series: ${catalog.series.map((s) => `${s.code} "${s.title}" (${s.episodes} eps, free up to ${s.freeUntil})`).join("; ") || "none"}
Approved templates you may use ({{1}} = series title, {{2}} = episode; the button opens the viewer's link to that episode):
${catalog.templates.map((t) => `- ${t.name} [${t.category}${t.quickReply ? ", quick reply" : ""}]: ${t.body}`).join("\n") || "- none approved yet"}

How to decide:
- A viewer who was hooked on a series (watched several episodes) and stalled: a hint about their next episode of THAT series, even if they started another series since.
- A viewer who bounced off a new series quickly but loved an older one: bring them back to the older one.
- A viewer who finished a series, or tried several without sticking: series_picks with 2–3 live series they haven't finished, matched to what they watched. Only if ${PICKS_TEMPLATE} is approved.
- Don't message someone who ignored our last two messages; don't repeat a template they ignored; never pick a series they finished.
- flag only for something the team should see (e.g. paid but stopped right after paying).
- Write reasons the team can check against the viewer's history.

What the team decided about your earlier suggestions (learn from the notes):
${reviews}

Results so far:
${results}
- holdout (no messages, for comparison): ${learning.holdout.reviewed} viewers, ${pct(learning.holdout.cameBack, learning.holdout.reviewed)} came back on their own

Answer only by calling decide, with exactly one decision per viewer.`;
}

export function viewersMessage(viewers: ViewerSummary[]): string {
  return `Viewers to review today:\n${viewers.map((v) => JSON.stringify(v)).join("\n")}`;
}

/** Keep only decisions the platform can carry out; anything invalid becomes a team flag with the reason. */
export function validateDecisions(raw: unknown, viewers: ViewerSummary[], catalog: Catalog): Decision[] {
  const list = Array.isArray((raw as { decisions?: unknown })?.decisions) ? ((raw as { decisions: unknown[] }).decisions as Record<string, unknown>[]) : [];
  const live = new Map(catalog.series.map((s) => [s.code, s]));
  const approved = new Set(catalog.templates.map((t) => t.name));
  const out: Decision[] = [];
  for (const v of viewers) {
    const d = list.find((x) => String(x?.ref) === v.ref);
    const base: Decision = { ref: v.ref, action: "none", template: "", series: "", episode: 0, picks: [], reason: String(d?.reason ?? "").slice(0, 300), priority: Math.min(3, Math.max(1, Math.round(Number(d?.priority) || 2))) };
    if (!d) {
      out.push({ ...base, reason: "The agent gave no decision for this viewer." });
      continue;
    }
    const action = String(d.action).toLowerCase();
    const invalid = (why: string) => out.push({ ...base, action: "flag", reason: `${base.reason} [Not sendable: ${why}]`.trim() });

    if (action === "template") {
      const name = String(d.template ?? "");
      const code = String(d.series ?? "").toUpperCase();
      const series = live.get(code);
      if (!approved.has(name) || name === PICKS_TEMPLATE) {
        invalid(`template "${name}" isn't an approved template`);
        continue;
      }
      if (!series) {
        invalid(`series "${code}" isn't live`);
        continue;
      }
      if (v.series.find((s) => s.code === code)?.finished) {
        invalid(`viewer already finished ${code}`);
        continue;
      }
      const episode = Math.min(Math.max(Math.round(Number(d.episode) || 1), 1), series.episodes);
      out.push({ ...base, action: "template", template: name, series: code, episode });
    } else if (action === "series_picks") {
      if (!approved.has(PICKS_TEMPLATE)) {
        invalid(`the ${PICKS_TEMPLATE} template isn't approved yet`);
        continue;
      }
      const finished = new Set(v.series.filter((s) => s.finished).map((s) => s.code));
      const picks = [...new Set((Array.isArray(d.picks) ? d.picks : []).map((c) => String(c).toUpperCase()))].filter((c) => live.has(c) && !finished.has(c)).slice(0, 3);
      if (picks.length < 2) {
        invalid("fewer than 2 live series to offer");
        continue;
      }
      out.push({ ...base, action: "series_picks", template: PICKS_TEMPLATE, series: picks[0], picks });
    } else if (action === "flag") {
      out.push({ ...base, action: "flag" });
    } else {
      out.push(base);
    }
  }
  return out;
}

/** Autopilot is earned: enough reviews, mostly approved. */
export function autopilotReadiness(reviewed: number, approved: number): { ready: boolean; why: string } {
  const NEED = 50;
  const RATE = 0.75;
  if (reviewed < NEED) return { ready: false, why: `${reviewed} of ${NEED} suggestions reviewed so far.` };
  if (approved / reviewed < RATE) return { ready: false, why: `The team approved ${pct(approved, reviewed)} of suggestions; autopilot needs at least ${RATE * 100}%.` };
  return { ready: true, why: `The team approved ${pct(approved, reviewed)} of the last ${reviewed} suggestions.` };
}
