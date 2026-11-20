// Rebuilds a flow from untrusted JSON (the browser), keeping only known fields with safe sizes.
// Anything unrecognised is dropped; the result is always a well-formed FlowGraph or null.

import type { Bi, Condition, FlowButton, FlowEdge, FlowGraph, FlowNode, MediaRef, NodeData } from "./types";

const MAX_NODES = 200;
const MAX_EDGES = 600;
const ID = /^[A-Za-z0-9_-]{1,40}$/;

type J = Record<string, unknown>;
const obj = (v: unknown): J => (v && typeof v === "object" && !Array.isArray(v) ? (v as J) : {});
const str = (v: unknown, max = 1100) => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(Math.round(n), min), max) : fallback;
};
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
const bi = (v: unknown, max = 1100): Bi => ({ ar: str(obj(v).ar, max), en: str(obj(v).en, max) });
const id = (v: unknown) => (typeof v === "string" && ID.test(v) ? v : null);

function media(v: unknown): MediaRef | null {
  const m = obj(v);
  const type = m.type === "video" ? "video" : m.type === "image" ? "image" : null;
  if (!type) return null;
  if (m.source === "poster" || m.source === "trailer") return { source: m.source, type: m.source === "poster" ? "image" : "video" };
  const url = str(m.url, 1000);
  const assetId = str(m.assetId, 40);
  if (!/^https:\/\//.test(url) || !/^[0-9a-f-]{36}$/.test(assetId)) return null;
  return { assetId, url, type, name: str(m.name, 120) || undefined };
}

function buttons(v: unknown): FlowButton[] {
  const out: FlowButton[] = [];
  for (const b of Array.isArray(v) ? v.slice(0, 3) : []) {
    const bid = id(obj(b).id);
    if (bid && !out.some((x) => x.id === bid)) out.push({ id: bid, title: bi(obj(b).title, 40) });
  }
  return out;
}

function condition(v: unknown): Condition {
  const c = obj(v);
  if (c.check === "reached_episode") return { check: "reached_episode", episode: num(c.episode, 1, 999, 1) };
  if (c.check === "language_en" || c.check === "paid") return { check: c.check };
  return { check: "opted_in" };
}

function data(v: unknown): NodeData | null {
  const d = obj(v);
  switch (d.kind) {
    case "start":
      return { kind: "start" };
    case "message":
      return { kind: "message", body: bi(d.body), buttons: buttons(d.buttons), media: media(d.media) };
    case "language":
      return { kind: "language", body: bi(d.body), btnAr: str(d.btnAr, 40), btnEn: str(d.btnEn, 40), skipIfKnown: bool(d.skipIfKnown, true), media: media(d.media) };
    case "episode":
      return { kind: "episode", episode: num(d.episode, 1, 999, 1), caption: bi(d.caption), buttons: buttons(d.buttons) };
    case "link":
      return { kind: "link", episode: d.episode === "resume" ? "resume" : num(d.episode, 1, 999, 1), body: bi(d.body), button: bi(d.button, 40), media: media(d.media) };
    case "optin":
      return { kind: "optin", body: bi(d.body), yes: bi(d.yes, 40), no: bi(d.no, 40), skipIfAnswered: bool(d.skipIfAnswered, true) };
    case "wait":
      return { kind: "wait", minutes: num(d.minutes, 1, 43200, 60) };
    case "condition":
      return { kind: "condition", condition: condition(d.condition) };
    case "template":
      return { kind: "template", name: /^[a-z0-9_]{0,512}$/.test(str(d.name, 512)) ? str(d.name, 512) : "" };
    case "suggest":
      return { kind: "suggest" };
    default:
      return null;
  }
}

export function sanitizeGraph(input: unknown): FlowGraph | null {
  const g = obj(input);
  if (!Array.isArray(g.nodes) || !Array.isArray(g.edges)) return null;
  if (g.nodes.length > MAX_NODES || g.edges.length > MAX_EDGES) return null;
  const nodes: FlowNode[] = [];
  for (const raw of g.nodes) {
    const n = obj(raw);
    const nid = id(n.id);
    const nd = data(n.data);
    const p = obj(n.position);
    if (!nid || !nd || nodes.some((x) => x.id === nid)) continue;
    nodes.push({ id: nid, position: { x: num(p.x, -100000, 100000, 0), y: num(p.y, -100000, 100000, 0) }, data: nd });
  }
  const ids = new Set(nodes.map((n) => n.id));
  const edges: FlowEdge[] = [];
  for (const raw of g.edges) {
    const e = obj(raw);
    const eid = id(e.id);
    const source = id(e.source);
    const target = id(e.target);
    const handle = id(e.sourceHandle);
    if (!eid || !source || !target || !handle || !ids.has(source) || !ids.has(target)) continue;
    if (edges.some((x) => x.source === source && x.sourceHandle === handle)) continue; // one arrow per port
    edges.push({ id: eid, source, sourceHandle: handle, target });
  }
  return { v: 1, nodes, edges };
}

/** Media assets a flow uses (for the library's "used in" and to block deleting them). */
export function assetIdsIn(g: FlowGraph | null): Set<string> {
  const out = new Set<string>();
  for (const n of g?.nodes ?? []) {
    const m = "media" in n.data ? n.data.media : null;
    if (m && "assetId" in m) out.add(m.assetId);
  }
  return out;
}
