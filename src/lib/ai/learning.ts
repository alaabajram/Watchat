// How "Build with AI" learns from the team, per label and per canvas kind (series, sequence, shared replies).
// Pure: no database or network (flow-agent.ts and the actions do the storing), unit-tested in learning.test.ts.
//
// Signals:
// 1. Ratings and notes the team gives a draft (👍 / 👎 + "what should it do differently?").
// 2. Edits: what the team changed in an AI draft before publishing it (texts rewritten, cards removed or added).
// 3. Results (series flows): which cards viewers tap or open most and least, from the CTR meters.
// The AI folds 1 and 2 into a short list of house rules (≤ 12) the team can read and edit; every draft
// prompt includes those rules, a few recent before/after edits, and the best and weakest cards.

import type { CardStat } from "../ctr/ctr";
import { CARD_LABELS, type FlowGraph, type FlowNode, type NodeData } from "../flows/types";
import type { Tool } from "./anthropic";

export type Lesson = { text: string; source: "ai" | "team"; at: string };
export type TextEdit = { card: string; field: string; before: string; after: string };
export type DraftEdits = { texts: TextEdit[]; removed: string[]; added: string[]; kept: number; total: number };
export type Signal = { request: string; rating: -1 | 1 | null; feedback: string | null; edits: DraftEdits | null };

export const MAX_LESSONS = 12;
const MAX_LESSON_CHARS = 220;

const cardName = (n: FlowNode) => n.name || CARD_LABELS[n.data.kind].split(":")[0];

/** The texts a card shows viewers, by field, for comparing drafts. */
export function cardTexts(d: NodeData): Record<string, string> {
  const out: Record<string, string> = {};
  const bi = (field: string, b: { ar: string; en: string }) => {
    if (b.ar.trim()) out[`${field} (ar)`] = b.ar.trim();
    if (b.en.trim()) out[`${field} (en)`] = b.en.trim();
  };
  switch (d.kind) {
    case "message":
      bi("message", d.body);
      d.buttons.forEach((b, i) => bi(`button ${i + 1}`, b.title));
      break;
    case "episode":
      bi("caption", d.caption);
      d.buttons.forEach((b, i) => bi(`button ${i + 1}`, b.title));
      break;
    case "link":
    case "account":
      bi("message", d.body);
      bi("button", d.button);
      break;
    case "optin":
      bi("question", d.body);
      bi("yes", d.yes);
      bi("no", d.no);
      break;
    case "language":
      bi("message", d.body);
      break;
    case "list":
      bi("message", d.body);
      bi("menu button", d.button);
      d.rows.forEach((r, i) => bi(`row ${i + 1}`, r.title));
      break;
    case "choice":
      bi("message", d.body);
      break;
    case "keyword":
      out.words = d.words.join(", ");
      break;
    case "template":
      out.template = d.name;
      break;
  }
  return out;
}

/** What the team changed in the AI's draft before publishing (cards matched by id, as the canvas keeps them). */
export function draftEdits(ai: FlowGraph, published: FlowGraph): DraftEdits {
  const texts: TextEdit[] = [];
  const removed: string[] = [];
  let kept = 0;
  for (const n of ai.nodes) {
    const p = published.nodes.find((x) => x.id === n.id);
    if (!p || p.data.kind !== n.data.kind) {
      removed.push(cardName(n));
      continue;
    }
    const before = cardTexts(n.data);
    const after = cardTexts(p.data);
    let same = true;
    for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if ((before[field] ?? "") !== (after[field] ?? "")) {
        same = false;
        texts.push({ card: cardName(p), field, before: before[field] ?? "", after: after[field] ?? "" });
      }
    }
    if (same) kept++;
  }
  const added = published.nodes.filter((p) => !ai.nodes.some((n) => n.id === p.id)).map(cardName);
  return { texts: texts.slice(0, 40), removed, added, kept, total: ai.nodes.length };
}

export const hasEdits = (e: DraftEdits | null) => Boolean(e && (e.texts.length || e.removed.length || e.added.length));

const clip = (t: string, n: number) => (Array.from(t).length > n ? `${Array.from(t).slice(0, n).join("")}…` : t);

/** One signal as plain text for the lesson writer. */
export function describeSignal(s: Signal): string {
  const lines = [`Request: ${clip(s.request, 300)}`];
  if (s.rating) lines.push(`Rating: ${s.rating > 0 ? "good" : "not good"}`);
  if (s.feedback?.trim()) lines.push(`Team note: ${clip(s.feedback.trim(), 500)}`);
  if (s.edits && hasEdits(s.edits)) {
    lines.push(`Kept unchanged: ${s.edits.kept} of ${s.edits.total} cards`);
    for (const t of s.edits.texts.slice(0, 10)) lines.push(`Rewrote ${t.card} ${t.field}: "${clip(t.before, 160)}" → "${clip(t.after, 160)}"`);
    if (s.edits.removed.length) lines.push(`Removed: ${s.edits.removed.slice(0, 10).join(", ")}`);
    if (s.edits.added.length) lines.push(`Added: ${s.edits.added.slice(0, 10).join(", ")}`);
  } else if (s.edits) {
    lines.push("Published without changes.");
  }
  return lines.join("\n");
}

/** Tool the AI uses to rewrite the house rules from the current rules and new signals. */
export const LESSONS_TOOL: Tool = {
  name: "write_lessons",
  description: "Write the updated house rules for drafting flows for this label.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["rules"],
    properties: {
      rules: {
        type: "array",
        description: `At most ${MAX_LESSONS} short, concrete rules (one sentence each, max ${MAX_LESSON_CHARS} characters), most important first.`,
        items: { type: "string" },
      },
    },
  },
};

export function lessonsSystemPrompt(kind: string): string {
  return `You maintain the house rules an AI follows when it drafts WhatsApp ${kind === "shared" ? "shared replies" : kind === "sequence" ? "follow-up sequences" : "series chat flows"} for one label of Watchat (Arabic-first micro-dramas).
You get the current rules (team rules are marked [team] and must be kept as they are, unless a newer team note contradicts them) and new signals: ratings, the team's notes, and what the team rewrote, removed or added in AI drafts before publishing.
Turn the signals into general, reusable rules about tone, length, wording, emoji, structure and timing: what the team consistently wants. Merge duplicates, drop rules that newer signals contradict, ignore one-off details tied to a single series.
Write each rule in English (quote Arabic phrases where useful), as an instruction ("Keep messages under 3 lines", "Use Gulf Arabic like «وش صار؟», not formal «ماذا حدث؟»"). Never include phone numbers, links or personal data.`;
}

export function lessonsUserPrompt(current: Lesson[], signals: Signal[]): string {
  const rules = current.length ? current.map((l) => `- ${l.source === "team" ? "[team] " : ""}${l.text}`).join("\n") : "(none yet)";
  return `Current rules:\n${rules}\n\nNew signals:\n${signals.map((s, i) => `#${i + 1}\n${describeSignal(s)}`).join("\n\n")}`;
}

/** Clean the AI's rules; team rules are always kept. */
export function mergeLessons(current: Lesson[], raw: unknown, now: string): Lesson[] {
  const o = (raw && typeof raw === "object" ? raw : {}) as { rules?: unknown };
  const proposed = (Array.isArray(o.rules) ? o.rules : [])
    .map((r) => String(r ?? "").replace(/^\[team\]\s*/i, "").replace(/\s+/g, " ").trim())
    .filter((t) => t.length >= 6 && !/https?:\/\/|\+?\d[\d\s-]{7,}/.test(t))
    .map((t) => clip(t, MAX_LESSON_CHARS));
  const team = current.filter((l) => l.source === "team");
  const out: Lesson[] = [...team];
  for (const t of proposed) {
    if (out.length >= MAX_LESSONS) break;
    if (out.some((l) => l.text.toLowerCase() === t.toLowerCase())) continue;
    const prev = current.find((l) => l.text === t);
    out.push({ text: t, source: "ai", at: prev?.at ?? now });
  }
  return out;
}

/** Rules the team edits in the AI panel. */
export function cleanTeamLessons(raw: unknown, current: Lesson[], now: string): Lesson[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: Lesson[] = [];
  for (const r of list.slice(0, MAX_LESSONS)) {
    const o = (r && typeof r === "object" ? r : {}) as { text?: unknown; source?: unknown };
    const text = clip(String(o.text ?? "").replace(/\s+/g, " ").trim(), MAX_LESSON_CHARS);
    if (text.length < 3 || out.some((l) => l.text === text)) continue;
    const prev = current.find((l) => l.text === text);
    out.push({ text, source: prev ? prev.source : "team", at: prev?.at ?? now });
  }
  return out;
}

/** Best and weakest cards (last 30 days), for the prompt: what viewers actually respond to. */
export function cardResults(g: FlowGraph, stats: Record<string, CardStat>, minReached = 20): { best: string[]; weak: string[] } {
  const rows = g.nodes
    .map((n) => ({ n, s: stats[n.id] }))
    .filter((x) => x.s && x.s.reached >= minReached)
    .map((x) => {
      const t = cardTexts(x.n.data);
      const text = t["message (ar)"] ?? t["caption (ar)"] ?? t["question (ar)"] ?? Object.values(t)[0] ?? "";
      return { rate: x.s!.clicked / x.s!.reached, line: `${cardName(x.n)} (${Math.round((x.s!.clicked / x.s!.reached) * 100)}% of ${x.s!.reached}): "${clip(text, 140)}"` };
    })
    .sort((a, b) => b.rate - a.rate);
  if (rows.length < 2) return { best: [], weak: [] };
  const k = Math.min(3, Math.floor(rows.length / 2));
  return { best: rows.slice(0, k).map((r) => r.line), weak: rows.slice(-k).map((r) => r.line) };
}

/** The "what this team has taught you" part of the draft prompt. Empty when there is nothing yet. */
export function learnedPrompt(opts: { lessons: Lesson[]; examples: TextEdit[]; results?: { best: string[]; weak: string[] } }): string {
  const parts: string[] = [];
  if (opts.lessons.length) parts.push(`House rules this team taught you (follow them; they override general style advice above):\n${opts.lessons.map((l) => `- ${l.text}`).join("\n")}`);
  if (opts.examples.length)
    parts.push(
      `Recent rewrites by the team (your draft → what they published). Write like the "after" side:\n${opts.examples
        .slice(0, 6)
        .map((e) => `- ${e.card} ${e.field}: "${clip(e.before, 140)}" → "${clip(e.after, 140)}"`)
        .join("\n")}`,
    );
  if (opts.results && (opts.results.best.length || opts.results.weak.length))
    parts.push(
      `What viewers respond to in this flow (taps / link opens, last 30 days):\nStrongest: ${opts.results.best.join("; ") || "-"}\nWeakest: ${opts.results.weak.join("; ") || "-"}\nWrite more like the strongest cards; improve the weakest when asked to change them.`,
    );
  return parts.join("\n\n");
}
