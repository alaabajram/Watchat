import { describe, expect, it } from "vitest";
import { resumeAfterWait, runFrom, type FlowEnv } from "./engine";
import { sanitizeGraph } from "./sanitize";
import type { Condition, FlowGraph, NodeData } from "./types";
import { templateNamesIn, validateFlow, validateSequence } from "./validate";

const node = (id: string, data: NodeData) => ({ id, position: { x: 0, y: 0 }, data });
const edge = (source: string, target: string, sourceHandle = "next") => ({ id: `${source}-${sourceHandle}`, source, sourceHandle, target });

// Trigger → Day-1 reminder → wait 2 days → came back? yes → End · no → Last-chance offer
const graph: FlowGraph = {
  v: 1,
  nodes: [
    node("t", { kind: "trigger", trigger: "stopped_mid_series", delayHours: 24, seriesCode: null }),
    node("tpl1", { kind: "template", name: "day1_reminder" }),
    node("w", { kind: "wait", minutes: 2 * 1440 }),
    node("c", { kind: "condition", condition: { check: "came_back" } }),
    node("end", { kind: "end" }),
    node("tpl2", { kind: "template", name: "last_chance" }),
  ],
  edges: [edge("t", "tpl1"), edge("tpl1", "w"), edge("w", "c"), edge("c", "end", "yes"), edge("c", "tpl2", "no")],
};

function env(cameBack: boolean, sent: string[]): FlowEnv {
  const no = async () => {
    throw new Error("free-form not allowed");
  };
  return {
    lang: "ar",
    title: () => "",
    totalEpisodes: 0,
    send: no,
    knownLanguage: () => null,
    setLanguage: async () => {},
    optIn: async () => "in",
    setOptIn: async () => {},
    link: no,
    progress: async () => ({ maxStarted: 0, maxCompleted: 0, lastWatchedAt: null }),
    noteChatEpisode: () => {},
    clip: async () => ({ url: null, title: null }),
    mediaUrl: () => null,
    meta: () => ({ tagline: "", genre: "", cast: "" }),
    template: async (name) => {
      sent.push(name);
      return "sent";
    },
    check: async (c: Condition) => c.check === "came_back" && cameBack,
    suggest: async () => {},
    seriesOptions: async () => [],
    canSendFreeform: () => false,
    track: async () => {},
    now: () => 0,
  };
}

const ctx = { templates: [{ name: "day1_reminder", approved: true }, { name: "last_chance", approved: true }], seriesCodes: ["SECRET1"] };

describe("sequence flows", () => {
  it("sends the first template from the Trigger, then waits", async () => {
    const sent: string[] = [];
    const r = await runFrom(graph, "t", env(false, sent));
    expect(sent).toEqual(["day1_reminder"]);
    expect(r).toEqual({ status: "wait", nodeId: "w", resumeAt: 2 * 1440 * 60_000 });
  });

  it("after the wait: ends if the viewer came back, otherwise sends the last-chance template", async () => {
    const back: string[] = [];
    expect(await resumeAfterWait(graph, "w", env(true, back))).toEqual({ status: "done" });
    expect(back).toEqual([]);
    const away: string[] = [];
    expect(await resumeAfterWait(graph, "w", env(false, away))).toEqual({ status: "done" });
    expect(away).toEqual(["last_chance"]);
  });

  it("passes the publishing checks and lists its templates", () => {
    expect(validateSequence(graph, ctx).filter((i) => i.level === "error")).toEqual([]);
    expect(templateNamesIn(graph)).toEqual(["day1_reminder", "last_chance"]);
  });

  it("refuses free-form cards, a missing Trigger, and sequences that send nothing", () => {
    const withMessage: FlowGraph = { ...graph, nodes: [...graph.nodes, node("m", { kind: "message", body: { ar: "مرحبا", en: "Hi" }, buttons: [], media: null })], edges: [...graph.edges] };
    expect(validateSequence(withMessage, ctx).some((i) => i.level === "error" && i.nodeId === "m")).toBe(true);
    const noTrigger: FlowGraph = { ...graph, nodes: graph.nodes.filter((n) => n.id !== "t"), edges: graph.edges.filter((e) => e.source !== "t") };
    expect(validateSequence(noTrigger, ctx).some((i) => /exactly one Trigger/.test(i.message))).toBe(true);
    const silent: FlowGraph = { v: 1, nodes: [graph.nodes[0], node("end", { kind: "end" })], edges: [edge("t", "end")] };
    expect(validateSequence(silent, ctx).some((i) => /never sends anything/.test(i.message))).toBe(true);
  });

  it("warns (doesn't block) while a template waits for Meta's approval", () => {
    const issues = validateSequence(graph, { ...ctx, templates: [{ name: "day1_reminder", approved: false }, { name: "last_chance", approved: true }] });
    expect(issues.some((i) => i.level === "warning" && /waiting for Meta/.test(i.message))).toBe(true);
    expect(issues.some((i) => i.level === "error")).toBe(false);
  });

  it("keeps Trigger and End cards through the sanitizer; series flows reject Trigger cards", () => {
    const g = sanitizeGraph(JSON.parse(JSON.stringify(graph)));
    expect(g?.nodes.find((n) => n.id === "t")?.data).toEqual({ kind: "trigger", trigger: "stopped_mid_series", delayHours: 24, seriesCode: null });
    expect(g?.nodes.find((n) => n.id === "end")?.data).toEqual({ kind: "end" });
    expect(validateFlow(graph, { episodeCount: 10, templates: ctx.templates }).some((i) => /sequence flows/.test(i.message))).toBe(true);
  });
});
