import { describe, expect, it } from "vitest";
import { COPY, COPY_KEYS, type CopyKey } from "../bot/copy";
import { defaultFlow } from "../flows/defaults";
import { FLOW_TOOL, flowSystemPrompt, graphToSteps, scriptIssues, stepsToGraph, type AgentContext, type Step } from "./flow-draft";

const texts = Object.fromEntries(COPY_KEYS.map((k) => [k, { ar: COPY[k].ar, en: COPY[k].en }])) as Record<CopyKey, { ar: string; en: string }>;
const ctx: AgentContext = {
  code: "SECRETS01",
  titleAr: "أسرار",
  titleEn: "Secrets",
  episodeCount: 30,
  clips: [1, 2, 3],
  hasPoster: true,
  hasTrailer: true,
  assets: [{ id: "11111111-1111-1111-1111-111111111111", name: "Teaser cut", kind: "video", url: "https://cdn/teaser.mp4" }],
  templates: [{ name: "come_back", approved: true, bodyAr: "اشتقنا لك" }],
};
const step = (s: Partial<Step>): Step => ({ id: "x", kind: "message", ar: "", en: "", buttons: [], next: "", yes: "", no: "", episode: 0, minutes: 0, check: "none", template: "", media: "none", skip: false, ...s });

describe("AI flow drafts", () => {
  it("round-trips the canvas through steps without losing cards, arrows or positions", () => {
    const g = defaultFlow({ askLanguage: true, sendTrailer: true, hasTrailer: true, askOptIn: true, waEpisodeCount: 3, episodeCount: 30, texts });
    const back = stepsToGraph(graphToSteps(g), ctx, g);
    expect(back.nodes.map((n) => [n.id, n.position, n.data.kind])).toEqual(g.nodes.map((n) => [n.id, n.position, n.data.kind]));
    const arrows = (x: typeof g) => x.edges.map((e) => `${e.source}>${e.target}`).sort();
    expect(arrows(back)).toEqual(arrows(g));
    expect(scriptIssues(back, ctx).filter((i) => i.level === "error")).toEqual([]);
  });

  it("turns a written flow into connected cards, with media from the library", () => {
    const g = stepsToGraph(
      [
        step({ id: "start", kind: "start", next: "hook" }),
        step({ id: "hook", kind: "message", ar: "شوف شو صار 🔥", en: "See what happened 🔥", media: ctx.assets[0].id, buttons: [{ ar: "ابدأ", en: "Start", goto: "ep1" }] }),
        step({ id: "ep1", kind: "episode", episode: 1, ar: "الحلقة {n}", en: "Episode {n}", next: "lnk" }),
        step({ id: "lnk", kind: "link", episode: 2, ar: "كمّل الحلقة {next}", en: "Continue episode {next}", buttons: [{ ar: "كمّل", en: "Continue", goto: "" }], next: "w" }),
        step({ id: "w", kind: "wait", minutes: 1440, next: "c" }),
        step({ id: "c", kind: "condition", check: "OPTED_IN", yes: "t", no: "" }),
        step({ id: "t", kind: "template", template: "come_back" }),
      ],
      ctx,
      null,
    );
    expect(g.nodes).toHaveLength(7);
    expect(g.nodes.find((n) => n.id === "hook")?.data).toMatchObject({ media: { assetId: ctx.assets[0].id, type: "video" } });
    expect(g.edges.find((e) => e.source === "hook")).toMatchObject({ sourceHandle: "b1", target: "ep1" });
    expect(g.nodes.find((n) => n.id === "c")?.data).toMatchObject({ condition: { check: "opted_in" } });
    expect(scriptIssues(g, ctx).filter((i) => i.level === "error")).toEqual([]);
    // New cards are spread out, not stacked on one spot
    expect(new Set(g.nodes.map((n) => `${n.position.x},${n.position.y}`)).size).toBe(7);
  });

  it("drops arrows to missing steps and lets the checks catch WhatsApp limit breaks", () => {
    const g = stepsToGraph(
      [
        step({ id: "s", kind: "start", next: "m" }),
        step({ id: "m", kind: "message", ar: "اختر", en: "Pick", buttons: [{ ar: "زر طويل جدا جدا يتجاوز الحد المسموح", en: "OK", goto: "ghost" }] }),
        step({ id: "w", kind: "wait", minutes: 2000, next: "m2" }),
        step({ id: "m2", kind: "message", ar: "رجعنا", en: "Back" }),
      ],
      ctx,
      null,
    );
    expect(g.edges.some((e) => e.target === "ghost")).toBe(false);
    const errors = scriptIssues({ ...g, edges: [...g.edges, { id: "e", source: "m", sourceHandle: "b1", target: "w" }] }, ctx).filter((i) => i.level === "error");
    expect(errors.map((e) => e.message).join("\n")).toMatch(/20/);
    expect(errors.map((e) => e.message).join("\n")).toMatch(/23 hours/);
  });

  it("fits Claude's strict tool limits: every field required, no union types", () => {
    const walk = (schema: Record<string, unknown>): number => {
      let optional = 0;
      if (schema.anyOf || Array.isArray(schema.type)) throw new Error("union type");
      if (schema.type === "object") {
        const props = schema.properties as Record<string, Record<string, unknown>>;
        const req = new Set(schema.required as string[]);
        optional += Object.keys(props).filter((k) => !req.has(k)).length;
        expect(schema.additionalProperties).toBe(false);
        for (const p of Object.values(props)) optional += walk(p);
      }
      if (schema.type === "array") optional += walk(schema.items as Record<string, unknown>);
      return optional;
    };
    expect(walk(FLOW_TOOL.input_schema)).toBe(0);
    expect(flowSystemPrompt(ctx)).toContain("come_back (approved)");
  });
});
