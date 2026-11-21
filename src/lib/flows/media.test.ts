import { describe, expect, it } from "vitest";
import { previewStart } from "./preview";
import { sanitizeGraph } from "./sanitize";
import type { FlowGraph, MediaRef, NodeData } from "./types";

const img: MediaRef = { assetId: "11111111-1111-1111-1111-111111111111", url: "https://cdn.test/pic.jpg", type: "image", name: "pic" };
const vid: MediaRef = { assetId: "22222222-2222-2222-2222-222222222222", url: "https://cdn.test/cut.mp4", type: "video", name: "cut" };
const series = { titleAr: "أسرار", titleEn: "Secrets", episodeCount: 10, posterUrl: null, trailerUrl: null, clips: {}, others: [] };
const viewer = { language: "ar" as const, optIn: null, paid: false, reachedEpisode: 0, withinWindow: true };
const bi = (t: string) => ({ ar: t, en: t });

async function run(card: NodeData, templates = {}) {
  const g: FlowGraph = { v: 1, nodes: [{ id: "s", position: { x: 0, y: 0 }, data: { kind: "start" } }, { id: "c", position: { x: 0, y: 0 }, data: card }], edges: [{ id: "e", source: "s", sourceHandle: "next", target: "c" }] };
  const r = await previewStart(g, series, viewer, templates, "SECRETS01");
  return r.items.filter((i) => i.from === "bot").map((i) => (i.from === "bot" ? i.msg : null));
}

describe("media on every card that sends", () => {
  it("alerts question carries an image or video header", async () => {
    expect(await run({ kind: "optin", body: bi("تنبيهات؟"), yes: bi("نعم"), no: bi("لا"), skipIfAnswered: false, media: vid })).toMatchObject([
      { kind: "buttons", header: { type: "video", link: vid.url } },
    ]);
  });

  it("my account link carries an image header", async () => {
    expect(await run({ kind: "account", body: bi("حسابك"), button: bi("افتح"), media: img })).toMatchObject([{ kind: "cta_url", header: { type: "image", link: img.url } }]);
  });

  it("menu lists and the series list send their media just before (lists can't carry media)", async () => {
    expect(await run({ kind: "list", body: bi("القائمة"), button: bi("القائمة"), section: bi("القائمة"), rows: [{ id: "r1", title: bi("صف") }], media: img })).toMatchObject([
      { kind: "image", link: img.url },
      { kind: "list", body: "القائمة" },
    ]);
  });

  it("template cards pass their own header image", async () => {
    const msgs = await run({ kind: "template", name: "come_back", media: img }, { come_back: { approved: true, ar: { body: "ارجع لـ {{1}}", button: "كمّل" }, en: null } });
    expect(msgs).toMatchObject([{ kind: "cta_url", header: { type: "image", link: img.url } }]);
  });

  it("keeps cards without media unchanged and drops videos where only images are allowed", () => {
    const g = sanitizeGraph({
      v: 1,
      nodes: [
        { id: "a", position: { x: 0, y: 0 }, data: { kind: "optin", body: bi("x"), yes: bi("y"), no: bi("n"), skipIfAnswered: true } },
        { id: "b", position: { x: 0, y: 0 }, data: { kind: "account", body: bi("x"), button: bi("y"), media: vid } },
        { id: "c", position: { x: 0, y: 0 }, data: { kind: "template", name: "x", media: img } },
      ],
      edges: [],
    })!;
    expect("media" in g.nodes[0].data).toBe(false);
    expect("media" in g.nodes[1].data).toBe(false);
    expect(g.nodes[2].data).toMatchObject({ media: img });
  });
});
