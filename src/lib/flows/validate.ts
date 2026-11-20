// Checks a flow before it can be published: WhatsApp's limits, broken arrows, loops, and the 24-hour rule.

import { LIMITS } from "../whatsapp/messages";
import { pick } from "./engine";
import { CARD_LABELS, isFreeform, portsOf, waitsForInput, type FlowGraph, type FlowNode, type Lang } from "./types";

export type Issue = { level: "error" | "warning"; nodeId?: string; message: string };
export type ValidateCtx = { episodeCount: number; templates: { name: string; approved: boolean }[] };

export const LONG_WAIT_MINUTES = 23 * 60;
export const MAX_WAIT_MINUTES = 30 * 24 * 60;
const PLACEHOLDERS = new Set(["title", "n", "total", "next"]);
const len = (s: string) => Array.from(s.trim()).length;

export function validateFlow(g: FlowGraph, ctx: ValidateCtx): Issue[] {
  const issues: Issue[] = [];
  const err = (message: string, nodeId?: string) => issues.push({ level: "error", nodeId, message });
  const warn = (message: string, nodeId?: string) => issues.push({ level: "warning", nodeId, message });
  const ids = new Set(g.nodes.map((n) => n.id));
  const name = (n: FlowNode) => CARD_LABELS[n.data.kind];

  const starts = g.nodes.filter((n) => n.data.kind === "start");
  if (starts.length !== 1) err("The flow needs exactly one Start card.");

  const text = (n: FlowNode, label: string, b: { ar: string; en: string }, max: number, required = true) => {
    if (required && !b.ar.trim()) err(`${label}: Arabic text is empty.`, n.id);
    if (required && !b.en.trim()) warn(`${label}: no English text, English viewers will see the Arabic.`, n.id);
    for (const lang of ["ar", "en"] as Lang[]) {
      const v = pick(b, lang);
      if (len(v) > max) err(`${label} (${lang}) is ${len(v)} characters; WhatsApp allows ${max}.`, n.id);
      for (const m of v.matchAll(/\{([a-zA-Z]+)\}/g)) if (!PLACEHOLDERS.has(m[1])) err(`${label} uses {${m[1]}}; allowed: {title} {n} {total} {next}.`, n.id);
    }
  };
  const buttons = (n: FlowNode, list: { title: { ar: string; en: string } }[]) => {
    if (list.length > LIMITS.maxButtons) err(`${name(n)}: WhatsApp allows at most ${LIMITS.maxButtons} buttons.`, n.id);
    for (const lang of ["ar", "en"] as Lang[]) {
      const titles = list.map((b) => pick(b.title, lang));
      if (new Set(titles).size !== titles.length) err(`${name(n)}: button titles must be different from each other (${lang}).`, n.id);
    }
    list.forEach((b, i) => text(n, `Button ${i + 1}`, b.title, LIMITS.buttonTitle));
  };
  const episodeOk = (n: FlowNode, ep: number, label: string) => {
    if (!Number.isInteger(ep) || ep < 1 || ep > Math.max(ctx.episodeCount, 1)) err(`${label}: episode ${ep} doesn't exist (this series has ${ctx.episodeCount}).`, n.id);
  };

  for (const n of g.nodes) {
    const d = n.data;
    switch (d.kind) {
      case "message":
        text(n, "Message", d.body, d.buttons.length || !d.media ? LIMITS.body : LIMITS.caption, d.buttons.length > 0 || !d.media);
        buttons(n, d.buttons);
        break;
      case "language":
        text(n, "Language question", d.body, LIMITS.body);
        if (!d.btnAr.trim() || !d.btnEn.trim()) err("Language question: both button titles are needed.", n.id);
        if (len(d.btnAr) > LIMITS.buttonTitle || len(d.btnEn) > LIMITS.buttonTitle) err(`Language buttons: max ${LIMITS.buttonTitle} characters.`, n.id);
        break;
      case "episode":
        episodeOk(n, d.episode, "Episode card");
        text(n, "Episode caption", d.caption, LIMITS.caption);
        buttons(n, d.buttons);
        break;
      case "link":
        if (d.episode !== "resume") episodeOk(n, d.episode, "Web link");
        text(n, "Link message", d.body, LIMITS.body);
        text(n, "Link button", d.button, LIMITS.ctaText);
        if (d.media?.type === "video") err("Web link cards can only show an image, not a video.", n.id);
        break;
      case "optin":
        text(n, "Alerts question", d.body, LIMITS.body);
        text(n, "Yes button", d.yes, LIMITS.buttonTitle);
        text(n, "No button", d.no, LIMITS.buttonTitle);
        break;
      case "wait":
        if (!Number.isFinite(d.minutes) || d.minutes < 1 || d.minutes > MAX_WAIT_MINUTES) err("Wait must be between 1 minute and 30 days.", n.id);
        break;
      case "condition":
        if (d.condition.check === "reached_episode") episodeOk(n, d.condition.episode, "Condition");
        break;
      case "template": {
        const t = ctx.templates.find((x) => x.name === d.name);
        if (!d.name) err("Template card: pick a template.", n.id);
        else if (!t) err(`Template "${d.name}" doesn't exist. Create it in WhatsApp templates.`, n.id);
        else if (!t.approved) warn(`Template "${d.name}" isn't approved by Meta yet; it will be skipped until it is.`, n.id);
        break;
      }
    }
  }

  // Arrows
  for (const e of g.edges) {
    const src = g.nodes.find((n) => n.id === e.source);
    if (!src || !ids.has(e.target)) err("An arrow points to a card that no longer exists.");
    else if (!portsOf(src.data).some((p) => p.id === e.sourceHandle)) err(`${name(src)}: an arrow starts from a button that no longer exists.`, src.id);
  }
  for (const n of g.nodes) {
    for (const p of portsOf(n.data)) {
      const out = g.edges.filter((e) => e.source === n.id && e.sourceHandle === p.id);
      if (out.length > 1) err(`${name(n)}: "${p.label}" has more than one arrow. Use a Condition card to branch.`, n.id);
      if (out.length === 0 && waitsForInput(n.data)) warn(`${name(n)}: "${p.label}" leads nowhere; the chat ends there.`, n.id);
    }
  }

  // Reachability
  const start = starts[0];
  if (start) {
    if (!g.edges.some((e) => e.source === start.id)) err("Connect the Start card to the first card.", start.id);
    const seen = new Set<string>([start.id]);
    const queue = [start.id];
    while (queue.length) {
      const id = queue.shift()!;
      for (const e of g.edges.filter((x) => x.source === id)) if (!seen.has(e.target)) (seen.add(e.target), queue.push(e.target));
    }
    for (const n of g.nodes) if (!seen.has(n.id)) warn(`${name(n)} isn't connected to the flow, so it never runs.`, n.id);
  }

  // Loops that never stop for the viewer or for time
  const stops = (n: FlowNode) => waitsForInput(n.data) || n.data.kind === "wait";
  const state = new Map<string, 1 | 2>();
  const visit = (id: string): boolean => {
    const n = g.nodes.find((x) => x.id === id);
    if (!n || stops(n)) return false;
    if (state.get(id) === 1) return true;
    if (state.get(id) === 2) return false;
    state.set(id, 1);
    const loop = g.edges.filter((e) => e.source === id).some((e) => visit(e.target));
    state.set(id, 2);
    return loop;
  };
  for (const n of g.nodes) {
    if (visit(n.id)) {
      err("There's a loop with no button or Wait in it; the bot would repeat forever.", n.id);
      break;
    }
  }

  // 24-hour rule: after a long wait, only Templates (through Conditions/Waits) can be sent
  for (const w of g.nodes.filter((n) => n.data.kind === "wait" && n.data.minutes >= LONG_WAIT_MINUTES)) {
    const seen = new Set<string>();
    const queue = g.edges.filter((e) => e.source === w.id).map((e) => e.target);
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const n = g.nodes.find((x) => x.id === id);
      if (!n) continue;
      if (isFreeform(n.data)) {
        err(`${name(n)} comes after a wait of 23 hours or more. WhatsApp only allows approved templates then; use a Template card.`, n.id);
        continue;
      }
      for (const e of g.edges.filter((x) => x.source === id)) queue.push(e.target);
    }
  }
  return issues;
}

export const hasErrors = (issues: Issue[]) => issues.some((i) => i.level === "error");
