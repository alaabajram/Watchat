// Builds the standard scenario as a flow (language → trailer → chat episodes → web link → alerts),
// from a series' current settings and texts. Publishing it unchanged reproduces today's bot.

import type { CopyKey } from "../bot/copy";
import type { Bi, FlowEdge, FlowGraph, FlowNode, NodeData } from "./types";

export type DefaultFlowInput = {
  askLanguage: boolean;
  sendTrailer: boolean;
  hasTrailer: boolean;
  askOptIn: boolean;
  waEpisodeCount: number;
  episodeCount: number;
  texts: Record<CopyKey, Bi>;
};

export function newId(): string {
  return Math.random().toString(36).slice(2, 8);
}

export function defaultFlow(s: DefaultFlowInput): FlowGraph {
  const t = s.texts;
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  // Left to right in rows of four, matching the arrows (in on the left, out on the right).
  const PER_ROW = 4;
  const add = (data: NodeData): string => {
    const id = newId();
    const i = nodes.length;
    nodes.push({ id, position: { x: (i % PER_ROW) * 330, y: Math.floor(i / PER_ROW) * 400 }, data });
    return id;
  };
  const link = (source: string, sourceHandle: string, target: string) => edges.push({ id: newId(), source, sourceHandle, target });

  const start = add({ kind: "start" });
  // Ports still waiting for their next card; the next card added is linked from all of them.
  let open: { id: string; port: string }[] = [{ id: start, port: "next" }];
  const connect = (target: string, ...ports: string[]) => {
    for (const p of open) link(p.id, p.port, target);
    open = ports.map((port) => ({ id: target, port }));
  };
  const notForMe: { id: string; port: string }[] = [];

  if (s.askLanguage) {
    const id = add({ kind: "language", body: t.welcomeAskLanguage, btnAr: t.btnArabic.ar, btnEn: t.btnEnglishSubs.ar, skipIfKnown: true, media: { source: "poster", type: "image" } });
    connect(id, "ar", "en"); // both answers continue to the same next card
  }

  if (s.sendTrailer && s.hasTrailer) {
    const id = add({
      kind: "message",
      body: t.trailerBody,
      buttons: [
        { id: "start", title: t.btnStartEp1 },
        { id: "nfm", title: t.btnNotForMe },
      ],
      media: { source: "trailer", type: "video" },
    });
    connect(id, "start");
    notForMe.push({ id, port: "nfm" });
  }

  const chatEps = Math.max(0, Math.min(s.waEpisodeCount, Math.max(s.episodeCount - 1, 0)));
  for (let n = 1; n <= chatEps; n++) {
    const last = n === chatEps;
    const id = add({
      kind: "episode",
      episode: n,
      caption: t.episodeCaption,
      buttons: last
        ? []
        : [
            { id: "next", title: t.btnNext },
            { id: "nfm", title: t.btnNotForMe },
          ],
    });
    connect(id, "next");
    if (!last) notForMe.push({ id, port: "nfm" });
  }

  const linkId = add({ kind: "link", episode: Math.min(chatEps + 1, Math.max(s.episodeCount, 1)), body: t.cliffhangerBody, button: t.btnWatchEp, media: { source: "poster", type: "image" } });
  connect(linkId, "next");

  if (s.askOptIn) {
    const id = add({ kind: "optin", body: t.optInBody, yes: t.btnYesNotify, no: t.btnNoThanks, skipIfAnswered: true });
    connect(id);
  }

  if (notForMe.length) {
    const suggest = newId();
    nodes.push({ id: suggest, position: { x: PER_ROW * 330 + 40, y: 200 }, data: { kind: "suggest" } });
    for (const p of notForMe) link(p.id, p.port, suggest);
  }
  return { v: 1, nodes, edges };
}

