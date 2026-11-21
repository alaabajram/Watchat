import { describe, expect, it } from "vitest";
import { standardSharedFlow } from "../flows/shared";
import type { FlowGraph } from "../flows/types";
import { cardResults, cleanTeamLessons, describeSignal, draftEdits, hasEdits, learnedPrompt, mergeLessons, type Lesson } from "./learning";

const NOW = "2026-11-21T10:00:00.000Z";
const msg = (id: string, ar: string, name?: string) => ({ id, position: { x: 0, y: 0 }, data: { kind: "message" as const, body: { ar, en: "" }, buttons: [], media: null }, ...(name ? { name } : {}) });

describe("Build with AI learning", () => {
  const ai: FlowGraph = { v: 1, nodes: [msg("a", "مرحبا بك في واتشات، نتمنى لك مشاهدة ممتعة جدًا", "Welcome"), msg("b", "هل تريد المتابعة؟"), msg("c", "شكرًا")], edges: [] };

  it("sees what the team rewrote, removed and added before publishing", () => {
    const published: FlowGraph = { v: 1, nodes: [msg("a", "هلا 👋 جاهز؟", "Welcome"), msg("c", "شكرًا"), msg("d", "جديد", "Extra")], edges: [] };
    const e = draftEdits(ai, published);
    expect(e.texts).toEqual([{ card: "Welcome", field: "message (ar)", before: "مرحبا بك في واتشات، نتمنى لك مشاهدة ممتعة جدًا", after: "هلا 👋 جاهز؟" }]);
    expect(e.removed).toEqual(["Message"]);
    expect(e.added).toEqual(["Extra"]);
    expect(e).toMatchObject({ kept: 1, total: 3 });
    expect(hasEdits(e)).toBe(true);
    expect(describeSignal({ request: "make it warmer", rating: -1, feedback: "Too formal", edits: e })).toMatch(/Rewrote Welcome message \(ar\).*→ "هلا 👋 جاهز؟"/);
    expect(hasEdits(draftEdits(ai, ai))).toBe(false);
  });

  it("keeps team rules, cleans the AI's rules and caps them at 12", () => {
    const current: Lesson[] = [{ text: "Always end with a question", source: "team", at: NOW }];
    const raw = { rules: ["[team] Always end with a question", "Keep messages under 3 lines", "Call +971 50 123 4567", "x", ...Array.from({ length: 20 }, (_, i) => `Rule number ${i}`)] };
    const out = mergeLessons(current, raw, NOW);
    expect(out[0]).toEqual(current[0]);
    expect(out.map((l) => l.text)).toContain("Keep messages under 3 lines");
    expect(out.some((l) => /\+971/.test(l.text))).toBe(false);
    expect(out).toHaveLength(12);
    expect(out.filter((l) => l.text === "Always end with a question")).toHaveLength(1);
  });

  it("team edits keep where a rule came from and mark new ones as the team's", () => {
    const current: Lesson[] = [{ text: "Short messages", source: "ai", at: NOW }];
    const out = cleanTeamLessons([{ text: "Short messages" }, { text: "  Use Gulf Arabic  " }, { text: "ok" }], current, "2026-11-22T00:00:00.000Z");
    expect(out).toEqual([
      { text: "Short messages", source: "ai", at: NOW },
      { text: "Use Gulf Arabic", source: "team", at: "2026-11-22T00:00:00.000Z" },
    ]);
  });

  it("puts rules, rewrites and the best / weakest cards in the draft prompt", () => {
    const g = standardSharedFlow();
    const results = cardResults(g, { menu: { reached: 100, clicked: 60 }, account: { reached: 50, clicked: 5 }, support: { reached: 5, clicked: 5 } });
    expect(results.best[0]).toMatch(/^Menu \(60% of 100\)/);
    expect(results.weak[0]).toMatch(/^My account \(10% of 50\)/);
    const p = learnedPrompt({ lessons: [{ text: "Keep it short", source: "team", at: NOW }], examples: [{ card: "Menu", field: "message (ar)", before: "أ", after: "ب" }], results });
    expect(p).toMatch(/House rules this team taught you[\s\S]*- Keep it short/);
    expect(p).toMatch(/"أ" → "ب"/);
    expect(p).toMatch(/Strongest: Menu/);
    expect(learnedPrompt({ lessons: [], examples: [] })).toBe("");
  });
});
