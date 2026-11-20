import { describe, expect, it } from "vitest";
import { COPY, COPY_KEYS, type CopyKey } from "../bot/copy";
import { defaultFlow } from "./defaults";
import { previewSkipWait, previewStart, previewTap, type PreviewSeries, type SampleViewer } from "./preview";
import { buttonReplyId, parseButtonReplyId, type FlowGraph } from "./types";
import { validateFlow } from "./validate";
import { sanitizeBlock, sanitizeGraph } from "./sanitize";

const texts = Object.fromEntries(COPY_KEYS.map((k) => [k, { ar: COPY[k].ar, en: COPY[k].en }])) as Record<CopyKey, { ar: string; en: string }>;
const series: PreviewSeries = {
  titleAr: "أسرار",
  titleEn: "Secrets",
  episodeCount: 30,
  posterUrl: "https://cdn/poster.jpg",
  trailerUrl: "https://cdn/trailer.mp4",
  clips: { 1: { ar: "https://cdn/1.mp4", en: null }, 2: { ar: "https://cdn/2.mp4", en: null }, 3: { ar: "https://cdn/3.mp4", en: null } },
};
const viewer: SampleViewer = { language: null, optIn: null, paid: false, reachedEpisode: 0, withinWindow: true };
const std = () => defaultFlow({ askLanguage: true, sendTrailer: true, hasTrailer: true, askOptIn: true, waEpisodeCount: 3, episodeCount: 30, texts });
const ctx = { episodeCount: 30, templates: [{ name: "come_back", approved: true }] };

const lastButtons = (items: { from: string }[]) => {
  const m = [...items].reverse().find((i) => i.from === "bot") as unknown as { msg: { kind: string; buttons?: { id: string; title: string }[] } };
  return m.msg.buttons ?? [];
};
async function tapFirst(g: FlowGraph, s: Awaited<ReturnType<typeof previewStart>>) {
  const b = lastButtons(s.items)[0];
  const { nodeId, port } = parseButtonReplyId(b.id)!;
  return previewTap(g, s, nodeId, port, b.title);
}

describe("flows", () => {
  it("the standard flow reproduces today's chat and passes the publish checks", async () => {
    const g = std();
    expect(validateFlow(g, ctx).filter((i) => i.level === "error")).toEqual([]);

    let s = await previewStart(g, series, viewer, {}, "SECRETS01");
    expect(lastButtons(s.items).map((b) => b.title)).toEqual([COPY.btnArabic.ar, COPY.btnEnglishSubs.ar]);
    s = await tapFirst(g, s); // Arabic → trailer
    expect(lastButtons(s.items)[0].title).toBe(COPY.btnStartEp1.ar);
    s = await tapFirst(g, s); // Start → ep 1
    s = await tapFirst(g, s); // Next → ep 2
    s = await tapFirst(g, s); // Next → ep 3, link, alerts question
    const kinds = s.items.filter((i) => i.from === "bot").map((i) => (i as { msg: { kind: string } }).msg.kind);
    expect(kinds.slice(-3)).toEqual(["video", "cta_url", "buttons"]);
    expect(s.result.status).toBe("input");
  });

  it("skips the language question for viewers who already chose", async () => {
    const s = await previewStart(std(), series, { ...viewer, language: "en" }, {}, "SECRETS01");
    expect(lastButtons(s.items)[0].title).toBe(COPY.btnStartEp1.en);
  });

  it("waits, then sends a template, and blocks free-form messages after 24 hours", async () => {
    const g: FlowGraph = {
      v: 1,
      nodes: [
        { id: "s", position: { x: 0, y: 0 }, data: { kind: "start" } },
        { id: "w", position: { x: 0, y: 0 }, data: { kind: "wait", minutes: 1440 } },
        { id: "c", position: { x: 0, y: 0 }, data: { kind: "condition", condition: { check: "opted_in" } } },
        { id: "t", position: { x: 0, y: 0 }, data: { kind: "template", name: "come_back" } },
        { id: "m", position: { x: 0, y: 0 }, data: { kind: "message", body: { ar: "مرحبا", en: "Hi" }, buttons: [], media: null } },
      ],
      edges: [
        { id: "1", source: "s", sourceHandle: "next", target: "w" },
        { id: "2", source: "w", sourceHandle: "next", target: "c" },
        { id: "3", source: "c", sourceHandle: "yes", target: "t" },
        { id: "4", source: "c", sourceHandle: "no", target: "m" },
      ],
    };
    const issues = validateFlow(g, ctx);
    expect(issues.some((i) => i.level === "error" && i.nodeId === "m" && /23 hours/.test(i.message))).toBe(true);

    let s = await previewStart(g, series, { ...viewer, optIn: "in" }, { come_back: { approved: true, ar: { body: "اشتقنا لك في «{{1}}»", button: "كمّل" }, en: null } }, "X");
    expect(s.result.status).toBe("wait");
    s = await previewSkipWait(g, s);
    expect(s.items.some((i) => i.from === "bot" && i.msg.kind === "cta_url" && i.msg.body === "اشتقنا لك في «أسرار»")).toBe(true);

    let blocked = await previewStart(g, series, { ...viewer, optIn: "out", withinWindow: false }, {}, "X");
    blocked = await previewSkipWait(g, blocked);
    expect(blocked.result.status).toBe("blocked");
  });

  it("catches WhatsApp limits, broken arrows and loops", () => {
    const g: FlowGraph = {
      v: 1,
      nodes: [
        { id: "s", position: { x: 0, y: 0 }, data: { kind: "start" } },
        {
          id: "m",
          position: { x: 0, y: 0 },
          data: {
            kind: "message",
            body: { ar: "اختر {price}", en: "" },
            buttons: [1, 2, 3, 4].map((i) => ({ id: `b${i}`, title: { ar: i === 1 ? "زر طويل جدا جدا يتجاوز الحد" : `زر ${i}`, en: "" } })),
            media: null,
          },
        },
        { id: "c1", position: { x: 0, y: 0 }, data: { kind: "condition", condition: { check: "paid" } } },
        { id: "c2", position: { x: 0, y: 0 }, data: { kind: "condition", condition: { check: "paid" } } },
      ],
      edges: [
        { id: "1", source: "s", sourceHandle: "next", target: "m" },
        { id: "2", source: "m", sourceHandle: "b1", target: "c1" },
        { id: "3", source: "c1", sourceHandle: "yes", target: "c2" },
        { id: "4", source: "c2", sourceHandle: "yes", target: "c1" },
        { id: "5", source: "m", sourceHandle: "gone", target: "c1" },
      ],
    };
    const text = validateFlow(g, ctx).filter((i) => i.level === "error").map((i) => i.message).join("\n");
    expect(text).toMatch(/at most 3 buttons/);
    expect(text).toMatch(/WhatsApp allows 20/);
    expect(text).toMatch(/\{price\}/);
    expect(text).toMatch(/loop/);
    expect(text).toMatch(/button that no longer exists/);
  });

  it("encodes button replies so old buttons still route", () => {
    expect(parseButtonReplyId(buttonReplyId("ab12cd", "yes"))).toEqual({ nodeId: "ab12cd", port: "yes" });
    expect(parseButtonReplyId("ep:next")).toBeNull();
  });

  it("keeps card names and saves My cards blocks without Start, relative to the top-left card", () => {
    const g = std();
    const named = { ...g, nodes: g.nodes.map((n, i) => (i === 2 ? { ...n, name: "Trailer hook" } : n)) };
    expect(sanitizeGraph(named)?.nodes[2].name).toBe("Trailer hook");

    const pick = named.nodes.slice(0, 4); // Start + 3 cards
    const ids = new Set(pick.map((n) => n.id));
    const block = sanitizeBlock({ v: 1, nodes: pick, edges: named.edges.filter((e) => ids.has(e.source)) })!;
    expect(block.nodes.some((n) => n.data.kind === "start")).toBe(false);
    expect(block.nodes).toHaveLength(3);
    expect(Math.min(...block.nodes.map((n) => n.position.x))).toBe(0);
    expect(Math.min(...block.nodes.map((n) => n.position.y))).toBe(0);
    // Only arrows between saved cards are kept
    const kept = new Set(block.nodes.map((n) => n.id));
    expect(block.edges.every((e) => kept.has(e.source) && kept.has(e.target))).toBe(true);
    expect(block.nodes.find((n) => n.name === "Trailer hook")).toBeTruthy();
    expect(sanitizeBlock({ v: 1, nodes: [named.nodes[0]], edges: [] })).toBeNull(); // Start alone can't be saved
  });

  it("runs follow-ups from 'On the web' and stays quiet for viewers watching right now", async () => {
    const g: FlowGraph = {
      v: 1,
      nodes: [
        { id: "s", position: { x: 0, y: 0 }, data: { kind: "start" } },
        { id: "w", position: { x: 0, y: 0 }, data: { kind: "web" } },
        { id: "wait", position: { x: 0, y: 0 }, data: { kind: "wait", minutes: 120 } },
        { id: "c", position: { x: 0, y: 0 }, data: { kind: "condition", condition: { check: "watched_within", hours: 2 } } },
        { id: "t", position: { x: 0, y: 0 }, data: { kind: "template", name: "come_back" } },
      ],
      edges: [
        { id: "1", source: "w", sourceHandle: "next", target: "wait" },
        { id: "2", source: "wait", sourceHandle: "next", target: "c" },
        { id: "3", source: "c", sourceHandle: "no", target: "t" },
      ],
    };
    const tpl = { come_back: { approved: true, ar: { body: "كمّل «{{1}}» من الحلقة {{2}}", button: "كمّل" }, en: null } };
    // Stopped watching → reminder
    let s = await previewStart(g, series, { ...viewer, reachedEpisode: 5, optIn: "in" }, tpl, "X", "web");
    expect(s.result.status).toBe("wait");
    s = await previewSkipWait(g, s);
    expect(s.items.some((i) => i.from === "bot" && i.msg.kind === "cta_url")).toBe(true);
    // Still watching → nothing
    let busy = await previewStart(g, series, { ...viewer, reachedEpisode: 5, optIn: "in", watchedRecently: true }, tpl, "X", "web");
    busy = await previewSkipWait(g, busy);
    expect(busy.items.some((i) => i.from === "bot")).toBe(false);

    // Arrows can't point into an entry card, and only one 'On the web' card is allowed
    const bad = validateFlow(
      { ...g, nodes: [...g.nodes, { id: "w2", position: { x: 0, y: 0 }, data: { kind: "web" } }], edges: [...g.edges, { id: "4", source: "c", sourceHandle: "yes", target: "w" }] },
      ctx,
    )
      .filter((i) => i.level === "error")
      .map((i) => i.message)
      .join("\n");
    expect(bad).toMatch(/at most one/);
    expect(bad).toMatch(/can't point into/);
  });

  it("skips episodes already watched and links to where the viewer is", async () => {
    let s = await previewStart(std(), series, { ...viewer, language: "ar", reachedEpisode: 2 }, {}, "SECRETS01");
    // Started this series before → straight to the resume link (episode 3), then alerts
    const link = s.items.find((i) => i.from === "bot" && i.msg.kind === "cta_url") as { msg: { body: string } } | undefined;
    expect(link).toBeTruthy();
    expect(s.result.status).toBe("input");
    s = await previewStart(std(), series, { ...viewer, language: "ar" }, {}, "SECRETS01");
    expect(lastButtons(s.items)[0].title).toBe(COPY.btnStartEp1.ar); // new viewer still gets the trailer
  });
});
