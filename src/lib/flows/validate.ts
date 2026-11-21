// Checks a flow before it can be published: WhatsApp's limits, broken arrows, loops, and the 24-hour rule.

import { LIMITS } from "../whatsapp/messages";
import { pick } from "./engine";
import { CARD_LABELS, isEntry, isFreeform, normaliseWord, portsOf, SEQUENCE_CARDS, SEQUENCE_CHECKS, SHARED_CARDS, SHARED_CHECKS, waitsForInput, type Bi, type FlowGraph, type FlowNode, type Lang } from "./types";

export type Issue = { level: "error" | "warning"; nodeId?: string; message: string };
export type ValidateCtx = { episodeCount: number; templates: { name: string; approved: boolean }[]; seriesCodes?: string[] };

export const LONG_WAIT_MINUTES = 23 * 60;
export const MAX_WAIT_MINUTES = 30 * 24 * 60;
const PLACEHOLDERS = new Set(["title", "n", "total", "next", "tagline", "genre", "cast"]);
const len = (s: string) => Array.from(s.trim()).length;

export function validateFlow(g: FlowGraph, ctx: ValidateCtx): Issue[] {
  const issues: Issue[] = [];
  const err = (message: string, nodeId?: string) => issues.push({ level: "error", nodeId, message });
  const warn = (message: string, nodeId?: string) => issues.push({ level: "warning", nodeId, message });
  const ids = new Set(g.nodes.map((n) => n.id));
  const name = (n: FlowNode) => CARD_LABELS[n.data.kind];

  const starts = g.nodes.filter((n) => n.data.kind === "start");
  if (starts.length !== 1) err("The flow needs exactly one Start card.");
  const webs = g.nodes.filter((n) => n.data.kind === "web");
  if (webs.length > 1) err("Use at most one 'On the web' card.", webs[1].id);

  const text = (n: FlowNode, label: string, b: { ar: string; en: string }, max: number, required = true) => {
    if (required && !b.ar.trim()) err(`${label}: Arabic text is empty.`, n.id);
    if (required && !b.en.trim()) warn(`${label}: no English text, English viewers will see the Arabic.`, n.id);
    for (const lang of ["ar", "en"] as Lang[]) {
      const v = pick(b, lang);
      if (len(v) > max) err(`${label} (${lang}) is ${len(v)} characters; WhatsApp allows ${max}.`, n.id);
      for (const m of v.matchAll(/\{([a-zA-Z]+)\}/g)) if (!PLACEHOLDERS.has(m[1])) err(`${label} uses {${m[1]}}; allowed: {title} {n} {total} {next} {tagline} {genre} {cast}.`, n.id);
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
        if (d.condition.check === "came_back" || d.condition.check === "paid_since") err("Condition: that check is for sequence flows only.", n.id);
        if (d.condition.check === "has_series") err("Condition: that check is for Shared replies only.", n.id);
        if (d.condition.check === "watched_within" && (d.condition.hours < 1 || d.condition.hours > 720)) err("Condition: hours must be 1–720.", n.id);
        break;
      case "choice": {
        text(n, "Series choice message", d.body, LIMITS.body);
        if (!d.options.length || d.options.length > LIMITS.maxButtons) err(`Series choice: 1 to ${LIMITS.maxButtons} series.`, n.id);
        const fixed = d.options.map((o) => o.code).filter((c) => c !== "AUTO");
        if (new Set(fixed).size !== fixed.length) err("Series choice: the same series is picked twice.", n.id);
        if (ctx.seriesCodes) for (const c of fixed) if (!ctx.seriesCodes.includes(c)) err(`Series choice: ${c} isn't a live series.`, n.id);
        d.options.forEach((o, i) => {
          for (const lang of ["ar", "en"] as Lang[]) if (len(o.label[lang]) > LIMITS.buttonTitle) err(`Series choice option ${i + 1} (${lang}): max ${LIMITS.buttonTitle} characters.`, n.id);
        });
        if (d.options.some((o) => o.code !== "AUTO" && !o.label.ar.trim())) warn("Series choice: long series titles are cut to 20 characters on the button; add a short label if needed.", n.id);
        break;
      }
      case "trigger":
        err("Trigger cards belong to sequence flows.", n.id);
        break;
      case "keyword":
      case "list":
      case "account":
      case "action":
        err(`${name(n)} cards belong to Shared replies.`, n.id);
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
    const tgt = g.nodes.find((n) => n.id === e.target);
    if (tgt && isEntry(tgt.data)) err(`Arrows can't point into ${tgt.data.kind === "start" ? "Start" : "On the web"}; it's where the flow begins.`, tgt.id);
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

  // Reachability (from Start and from On the web)
  const start = starts[0];
  for (const w of webs) if (!g.edges.some((e) => e.source === w.id)) warn("'On the web' isn't connected, so it does nothing.", w.id);
  if (start) {
    if (!g.edges.some((e) => e.source === start.id)) err("Connect the Start card to the first card.", start.id);
    const seen = new Set<string>([start.id, ...webs.map((w) => w.id)]);
    const queue = [start.id, ...webs.map((w) => w.id)];
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
  // On the web: the viewer may not have messaged in 24 h, so free-form cards only reach some viewers.
  for (const w of webs) {
    const seen = new Set<string>();
    const queue = g.edges.filter((e) => e.source === w.id).map((e) => e.target);
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const n = g.nodes.find((x) => x.id === id);
      if (!n) continue;
      if (isFreeform(n.data) && !issues.some((i) => i.nodeId === n.id && /24 hours/.test(i.message))) {
        warn(`${name(n)} after 'On the web' only reaches viewers who messaged the bot in the last 24 hours; a Template card reaches everyone with alerts on.`, n.id);
      }
      if (waitsForInput(n.data)) continue;
      for (const e of g.edges.filter((x) => x.source === id)) queue.push(e.target);
    }
  }
  return issues;
}

export const hasErrors = (issues: Issue[]) => issues.some((i) => i.level === "error");

export type SequenceCtx = { templates: { name: string; approved: boolean }[]; seriesCodes: string[] };

/**
 * Checks a sequence flow before publishing. Sequences message viewers first (outside the 24-hour window),
 * so only Template cards may send; the flow begins at exactly one Trigger and must reach a Template.
 */
export function validateSequence(g: FlowGraph, ctx: SequenceCtx): Issue[] {
  const issues: Issue[] = [];
  const err = (message: string, nodeId?: string) => issues.push({ level: "error", nodeId, message });
  const warn = (message: string, nodeId?: string) => issues.push({ level: "warning", nodeId, message });
  const name = (n: FlowNode) => CARD_LABELS[n.data.kind].split(":")[0];
  const ids = new Set(g.nodes.map((n) => n.id));

  const triggers = g.nodes.filter((n) => n.data.kind === "trigger");
  if (triggers.length !== 1) err("A sequence needs exactly one Trigger card.");

  for (const n of g.nodes) {
    const d = n.data;
    if (!SEQUENCE_CARDS.includes(d.kind)) {
      err(`${name(n)} can't be used in a sequence: sequences message viewers first, so WhatsApp only allows approved templates.`, n.id);
      continue;
    }
    if (d.kind === "trigger") {
      if (d.delayHours < 1 || d.delayHours > 2160) err("Trigger: the delay must be between 1 hour and 90 days.", n.id);
      if (d.seriesCode && !ctx.seriesCodes.includes(d.seriesCode)) err(`Trigger: ${d.seriesCode} isn't one of your series.`, n.id);
    }
    if (d.kind === "wait" && (d.minutes < 60 || d.minutes > MAX_WAIT_MINUTES)) err("Wait: between 1 hour and 30 days in a sequence (the scheduler runs every 15 minutes).", n.id);
    if (d.kind === "condition") {
      if (!SEQUENCE_CHECKS.includes(d.condition.check)) err("Condition: that check isn't available in sequences.", n.id);
      if (d.condition.check === "watched_within" && (d.condition.hours < 1 || d.condition.hours > 720)) err("Condition: hours must be 1–720.", n.id);
    }
    if (d.kind === "template") {
      const t = ctx.templates.find((x) => x.name === d.name);
      if (!d.name) err("Template card: pick a template, or create one here and send it to Meta.", n.id);
      else if (!t) err(`Template "${d.name}" doesn't exist.`, n.id);
      else if (!t.approved) warn(`Template "${d.name}" is waiting for Meta's approval. The sequence won't start for new viewers until every template in it is approved.`, n.id);
    }
  }

  for (const e of g.edges) {
    const tgt = g.nodes.find((n) => n.id === e.target);
    const src = g.nodes.find((n) => n.id === e.source);
    if (tgt?.data.kind === "trigger") err("Arrows can't point into the Trigger; it's where the sequence begins.", tgt.id);
    if (!src || !ids.has(e.target)) err("An arrow points to a card that no longer exists.");
    else if (!portsOf(src.data).some((p) => p.id === e.sourceHandle)) err(`${name(src)}: an arrow starts from an exit that no longer exists.`, src.id);
  }
  for (const n of g.nodes) {
    for (const p of portsOf(n.data)) {
      if (g.edges.filter((e) => e.source === n.id && e.sourceHandle === p.id).length > 1) err(`${name(n)}: "${p.label}" has more than one arrow.`, n.id);
    }
  }

  // Everything reachable from the Trigger; at least one Template on the way.
  const trigger = triggers[0];
  if (trigger) {
    if (!g.edges.some((e) => e.source === trigger.id)) err("Connect the Trigger card to the first card.", trigger.id);
    const seen = new Set<string>([trigger.id]);
    const queue = [trigger.id];
    while (queue.length) {
      const id = queue.shift()!;
      for (const e of g.edges.filter((x) => x.source === id)) if (!seen.has(e.target)) (seen.add(e.target), queue.push(e.target));
    }
    for (const n of g.nodes) if (!seen.has(n.id)) warn(`${name(n)} isn't connected to the Trigger, so it never runs.`, n.id);
    if (!g.nodes.some((n) => seen.has(n.id) && n.data.kind === "template")) err("The sequence never sends anything: add a Template card after the Trigger.");
  }

  // A loop must contain a Wait, or the sequence would message the viewer again and again at once.
  const state = new Map<string, 1 | 2>();
  const visit = (id: string): boolean => {
    const n = g.nodes.find((x) => x.id === id);
    if (!n || n.data.kind === "wait") return false;
    if (state.get(id) === 1) return true;
    if (state.get(id) === 2) return false;
    state.set(id, 1);
    const loop = g.edges.filter((e) => e.source === id).some((e) => visit(e.target));
    state.set(id, 2);
    return loop;
  };
  for (const n of g.nodes) {
    if (visit(n.id)) {
      err("There's a loop with no Wait in it.", n.id);
      break;
    }
  }
  return issues;
}

/** Template names a flow uses (to hold a sequence until Meta has approved them all). */
export const templateNamesIn = (g: FlowGraph) => [...new Set(g.nodes.flatMap((n) => (n.data.kind === "template" && n.data.name ? [n.data.name] : [])))];

/** Words the bot always understands, whatever the shared flow says (opt-out must always work). */
export const RESERVED_WORDS = ["STOP", "UNSUBSCRIBE"];

/**
 * Checks the shared flow (Shared replies) before publishing. Replies go out right after the viewer's
 * message, so free-form cards are fine; waits, templates, episodes and series entry cards are not.
 */
export function validateShared(g: FlowGraph, ctx: { seriesCodes: string[] }): Issue[] {
  const issues: Issue[] = [];
  const err = (message: string, nodeId?: string) => issues.push({ level: "error", nodeId, message });
  const warn = (message: string, nodeId?: string) => issues.push({ level: "warning", nodeId, message });
  const name = (n: FlowNode) => CARD_LABELS[n.data.kind];
  const ids = new Set(g.nodes.map((n) => n.id));
  const text = (n: FlowNode, label: string, b: Bi, max: number, required = true) => {
    if (required && !b.ar.trim()) err(`${label}: Arabic text is empty.`, n.id);
    if (required && !b.en.trim()) warn(`${label}: no English text, English viewers will see the Arabic.`, n.id);
    for (const lang of ["ar", "en"] as Lang[]) {
      const v = pick(b, lang);
      if (len(v) > max) err(`${label} (${lang}) is ${len(v)} characters; WhatsApp allows ${max}.`, n.id);
      for (const m of v.matchAll(/\{([a-zA-Z]+)\}/g)) if (!PLACEHOLDERS.has(m[1])) err(`${label} uses {${m[1]}}; allowed: {title} {n}.`, n.id);
    }
  };

  const keywords = g.nodes.filter((n) => n.data.kind === "keyword");
  if (!keywords.length) err("Add at least one “Viewer sends” card: it's where a reply begins.");
  const owner = new Map<string, string>();
  let catchAll = 0;
  for (const n of g.nodes) {
    const d = n.data;
    if (!SHARED_CARDS.includes(d.kind)) {
      err(`${name(n).split(":")[0]} can't be used in Shared replies.`, n.id);
      continue;
    }
    switch (d.kind) {
      case "keyword": {
        if (d.anythingElse) catchAll++;
        if (!d.anythingElse && !d.words.length) err("Viewer sends: add at least one word.", n.id);
        for (const w of d.words) {
          const k = normaliseWord(w);
          if (!k) err(`Viewer sends: "${w}" has no letters or digits.`, n.id);
          else if (owner.has(k) && owner.get(k) !== n.id) err(`"${w}" is on two “Viewer sends” cards; the bot can only start one reply.`, n.id);
          else owner.set(k, n.id);
          if (/^[A-Z]{3,}\d{1,3}$/.test(k)) err(`"${w}" looks like a series code; viewers sending it would never reach the series.`, n.id);
          if (ctx.seriesCodes.includes(k)) err(`"${w}" is a series code.`, n.id);
        }
        break;
      }
      case "message":
        text(n, "Message", d.body, LIMITS.body, d.buttons.length > 0 || !d.media);
        if (d.buttons.length > LIMITS.maxButtons) err(`Message: WhatsApp allows at most ${LIMITS.maxButtons} buttons.`, n.id);
        d.buttons.forEach((b, i) => text(n, `Button ${i + 1}`, b.title, LIMITS.buttonTitle));
        break;
      case "list":
        text(n, "Menu message", d.body, LIMITS.body);
        text(n, "Menu button", d.button, LIMITS.listButton);
        text(n, "Menu heading", d.section, LIMITS.rowTitle);
        if (!d.rows.length) err("Menu list: add at least one row.", n.id);
        if (d.rows.length > LIMITS.maxRows) err(`Menu list: WhatsApp allows at most ${LIMITS.maxRows} rows.`, n.id);
        d.rows.forEach((r, i) => text(n, `Row ${i + 1}`, r.title, LIMITS.rowTitle));
        for (const lang of ["ar", "en"] as Lang[]) {
          const titles = d.rows.map((r) => pick(r.title, lang));
          if (new Set(titles).size !== titles.length) err(`Menu list: row titles must be different (${lang}).`, n.id);
        }
        break;
      case "link":
        text(n, "Link message", d.body, LIMITS.body);
        text(n, "Link button", d.button, LIMITS.ctaText);
        if (d.episode !== "resume") err("Player link: in Shared replies the link opens where the viewer left off.", n.id);
        break;
      case "account":
        text(n, "Account message", d.body, LIMITS.body);
        text(n, "Account button", d.button, LIMITS.ctaText);
        break;
      case "language":
        text(n, "Language question", d.body, LIMITS.body);
        if (!d.btnAr.trim() || !d.btnEn.trim()) err("Language question: both button titles are needed.", n.id);
        break;
      case "optin":
        text(n, "Alerts question", d.body, LIMITS.body);
        text(n, "Yes button", d.yes, LIMITS.buttonTitle);
        text(n, "No button", d.no, LIMITS.buttonTitle);
        break;
      case "condition":
        if (!SHARED_CHECKS.includes(d.condition.check)) err("Condition: that check isn't available in Shared replies.", n.id);
        break;
      case "choice":
        text(n, "Series choice message", d.body, LIMITS.body);
        for (const o of d.options) if (o.code !== "AUTO" && !ctx.seriesCodes.includes(o.code)) err(`Series choice: ${o.code} isn't a live series.`, n.id);
        break;
    }
  }
  if (catchAll > 1) err("Only one “Viewer sends” card can catch anything else.");

  for (const e of g.edges) {
    const tgt = g.nodes.find((n) => n.id === e.target);
    const src = g.nodes.find((n) => n.id === e.source);
    if (tgt?.data.kind === "keyword") err("Arrows can't point into a “Viewer sends” card; it's where a reply begins.", tgt.id);
    if (!src || !ids.has(e.target)) err("An arrow points to a card that no longer exists.");
    else if (!portsOf(src.data).some((p) => p.id === e.sourceHandle)) err(`${name(src)}: an arrow starts from a button that no longer exists.`, src.id);
  }
  for (const n of g.nodes) {
    for (const p of portsOf(n.data)) {
      const out = g.edges.filter((e) => e.source === n.id && e.sourceHandle === p.id);
      if (out.length > 1) err(`${name(n)}: "${p.label}" has more than one arrow.`, n.id);
      // A language tap changes the viewer's language by itself, so it needs no next card here.
      if (out.length === 0 && waitsForInput(n.data) && n.data.kind !== "language") warn(`${name(n)}: "${p.label}" leads nowhere; nothing happens when it's tapped.`, n.id);
      if (out.length === 0 && n.data.kind === "keyword") err("Connect this “Viewer sends” card to the reply.", n.id);
    }
  }

  // Reachable from some keyword card
  const seen = new Set<string>(keywords.map((k) => k.id));
  const queue = keywords.map((k) => k.id);
  while (queue.length) {
    const id = queue.shift()!;
    for (const e of g.edges.filter((x) => x.source === id)) if (!seen.has(e.target)) (seen.add(e.target), queue.push(e.target));
  }
  for (const n of g.nodes) if (!seen.has(n.id)) warn(`${name(n)} isn't connected to a “Viewer sends” card, so it never runs.`, n.id);

  // Loops without a button
  const state = new Map<string, 1 | 2>();
  const visit = (id: string): boolean => {
    const n = g.nodes.find((x) => x.id === id);
    if (!n || waitsForInput(n.data)) return false;
    if (state.get(id) === 1) return true;
    if (state.get(id) === 2) return false;
    state.set(id, 1);
    const loop = g.edges.filter((e) => e.source === id).some((e) => visit(e.target));
    state.set(id, 2);
    return loop;
  };
  for (const n of g.nodes) {
    if (visit(n.id)) {
      err("There's a loop with no button in it; the bot would repeat forever.", n.id);
      break;
    }
  }
  return issues;
}
