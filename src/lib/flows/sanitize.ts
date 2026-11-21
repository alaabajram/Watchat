// Rebuilds a flow from untrusted JSON (the browser), keeping only known fields with safe sizes.
// Anything unrecognised is dropped; the result is always a well-formed FlowGraph or null.

import type { Bi, Condition, FlowButton, FlowEdge, FlowGraph, FlowNode, ListRow, MediaRef, NodeData } from "./types";

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
  if (m.source === "series" && ["poster", "banner_wa", "banner_wide", "square"].includes(String(m.slot))) return { source: "series", slot: m.slot as "poster", type: "image" };
  if (m.source === "episode") return { source: "episode", episode: num(m.episode, 1, 999, 1), type: "video" };
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

function rows(v: unknown): ListRow[] {
  const out: ListRow[] = [];
  for (const r of Array.isArray(v) ? v.slice(0, 10) : []) {
    const rid = id(obj(r).id);
    if (rid && !out.some((x) => x.id === rid)) out.push({ id: rid, title: bi(obj(r).title, 40) });
  }
  return out;
}

function words(v: unknown): string[] {
  const out: string[] = [];
  for (const w of Array.isArray(v) ? v.slice(0, 30) : []) {
    const t = str(w, 40).trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

function condition(v: unknown): Condition {
  const c = obj(v);
  if (c.check === "reached_episode") return { check: "reached_episode", episode: num(c.episode, 1, 999, 1) };
  if (c.check === "watched_within") return { check: "watched_within", hours: num(c.hours, 1, 720, 24) };
  if (c.check === "language_en" || c.check === "paid" || c.check === "started" || c.check === "came_back" || c.check === "paid_since" || c.check === "has_series") return { check: c.check };
  return { check: "opted_in" };
}

function data(v: unknown): NodeData | null {
  const d = obj(v);
  switch (d.kind) {
    case "start":
      return { kind: "start" };
    case "web":
      return { kind: "web" };
    case "message":
      return { kind: "message", body: bi(d.body), buttons: buttons(d.buttons), media: media(d.media) };
    case "language":
      return { kind: "language", body: bi(d.body), btnAr: str(d.btnAr, 40), btnEn: str(d.btnEn, 40), skipIfKnown: bool(d.skipIfKnown, true), media: media(d.media) };
    case "episode":
      return { kind: "episode", episode: num(d.episode, 1, 999, 1), caption: bi(d.caption), buttons: buttons(d.buttons), skipIfWatched: bool(d.skipIfWatched, true) };
    case "link":
      return { kind: "link", episode: d.episode === "resume" ? "resume" : num(d.episode, 1, 999, 1), body: bi(d.body), button: bi(d.button, 40), media: media(d.media), resumeIfFurther: bool(d.resumeIfFurther, true) };
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
    case "choice": {
      const options = (Array.isArray(d.options) ? d.options : [])
        .slice(0, 3)
        .map((o) => {
          const code = str(obj(o).code, 20).toUpperCase();
          return { code: /^(AUTO|[A-Z]{3,}\d{1,3})$/.test(code) ? code : "AUTO", label: bi(obj(o).label, 40) };
        });
      return { kind: "choice", body: bi(d.body), options: options.length ? options : [{ code: "AUTO", label: { ar: "", en: "" } }], media: media(d.media) };
    }
    case "trigger": {
      const trigger = ["stopped_mid_series", "inactive", "finished_series"].includes(String(d.trigger)) ? (d.trigger as "inactive") : "stopped_mid_series";
      const code = str(d.seriesCode, 20).toUpperCase();
      return { kind: "trigger", trigger, delayHours: num(d.delayHours, 1, 2160, 24), seriesCode: /^[A-Z]{3,}\d{1,3}$/.test(code) ? code : null };
    }
    case "end":
      return { kind: "end" };
    case "keyword":
      return { kind: "keyword", words: words(d.words), anythingElse: bool(d.anythingElse, false) };
    case "list":
      return { kind: "list", body: bi(d.body), button: bi(d.button, 40), section: bi(d.section, 40), rows: rows(d.rows) };
    case "account":
      return { kind: "account", body: bi(d.body), button: bi(d.button, 40) };
    case "action":
      return { kind: "action", action: d.action === "opt_in" || d.action === "delete_data" ? d.action : "opt_out" };
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
    const name = str(n.name, 60).trim();
    nodes.push({ id: nid, position: { x: num(p.x, -100000, 100000, 0), y: num(p.y, -100000, 100000, 0) }, data: nd, ...(name ? { name } : {}) });
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

/** A saved "My cards" block: no Start card, at most 30 cards, positions relative to the top-left card. */
export function sanitizeBlock(input: unknown): FlowGraph | null {
  const g = sanitizeGraph(input);
  if (!g) return null;
  const nodes = g.nodes.filter((n) => n.data.kind !== "start" && n.data.kind !== "web" && n.data.kind !== "trigger" && n.data.kind !== "keyword").slice(0, 30);
  if (!nodes.length) return null;
  const ids = new Set(nodes.map((n) => n.id));
  const minX = Math.min(...nodes.map((n) => n.position.x));
  const minY = Math.min(...nodes.map((n) => n.position.y));
  return {
    v: 1,
    nodes: nodes.map((n) => ({ ...n, position: { x: n.position.x - minX, y: n.position.y - minY } })),
    edges: g.edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
  };
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
