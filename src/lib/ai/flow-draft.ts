// "Build with AI" in the flow builder: the AI writes a flow as a flat list of steps (every field
// required, no unions, so it fits Claude's strict tool limits); we turn the steps into cards and
// arrows, lay out new cards, and check the result with the same rules as Publish.
// Pure: no database or network, unit-tested in flow-draft.test.ts.

import { newId } from "../flows/defaults";
import { CARD_LABELS, type Condition, type FlowEdge, type FlowGraph, type FlowNode, type MediaRef, type NodeData, type NodeKind } from "../flows/types";
import { validateFlow, type Issue, type ValidateCtx } from "../flows/validate";
import { LIMITS } from "../whatsapp/messages";
import type { Tool } from "./anthropic";

const KINDS: NodeKind[] = ["start", "web", "message", "language", "episode", "link", "optin", "wait", "condition", "template", "suggest", "choice"];
const CHECKS = ["none", "opted_in", "language_en", "paid", "reached_episode", "started", "watched_within"] as const;
const ID = /^[A-Za-z0-9_-]{1,40}$/;

export type StepButton = { ar: string; en: string; goto: string };
export type Step = {
  id: string;
  kind: string;
  ar: string;
  en: string;
  buttons: StepButton[];
  next: string;
  yes: string;
  no: string;
  episode: number;
  minutes: number;
  check: string;
  template: string;
  media: string;
  skip: boolean;
};
export type FlowScript = { summary: string; notes: string; steps: Step[] };

export type AgentContext = {
  code: string;
  titleAr: string;
  titleEn: string;
  episodeCount: number;
  clips: number[]; // episodes with a chat clip uploaded
  hasPoster: boolean;
  hasTrailer: boolean;
  assets: { id: string; name: string; kind: "image" | "video"; url: string }[];
  templates: { name: string; approved: boolean; bodyAr: string | null }[];
  otherSeries?: { code: string; titleAr: string; titleEn: string }[];
};

const str = (description: string) => ({ type: "string", description });
export const FLOW_TOOL: Tool = {
  name: "write_flow",
  description: "Write the complete WhatsApp chat flow for the series as a list of steps.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["summary", "notes", "steps"],
    properties: {
      summary: str("2–4 short lines for the admin, in English: what the flow does and what you changed."),
      notes: str("Anything you couldn't do or the team must prepare (e.g. upload a clip, get a template approved). Empty if none."),
      steps: {
        type: "array",
        description: "Every card in the flow, including exactly one start step.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "kind", "ar", "en", "buttons", "next", "yes", "no", "episode", "minutes", "check", "template", "media", "skip"],
          properties: {
            id: str("Short unique id: letters, digits, - or _. Keep existing ids for steps you keep."),
            kind: { type: "string", enum: KINDS },
            ar: str("Arabic text: message body, episode caption, link message or alerts question. Language step: the full bilingual welcome. Empty for start/wait/condition/template/suggest."),
            en: str("English version of ar (for viewers who chose English subtitles). Empty where ar is empty or for the language step."),
            buttons: {
              type: "array",
              description:
                "message/episode: up to 3 reply buttons, each with goto. language: exactly 2 [Arabic button, English-subtitles button] with goto. optin: exactly 2 [yes, no] with goto. link: exactly 1 = the link button label (goto empty). choice: 1–3 series, goto = a series code or AUTO (a series the viewer hasn't started); ar/en = optional short button label (empty = series title). Others: empty.",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["ar", "en", "goto"],
                properties: { ar: str("Arabic title, max 20 characters"), en: str("English title, max 20 characters"), goto: str("id of the step this button leads to, or empty to end") },
              },
            },
            next: str("Step that follows when there are no reply buttons (start, web, message/episode without buttons, link, wait, template). Empty to end."),
            yes: str("condition only: step when the check is true. Empty to end."),
            no: str("condition only: step when the check is false. Empty to end."),
            episode: { type: "integer", description: "episode: episode number. link: episode to open (0 = where the viewer left off). condition reached_episode: the episode. Otherwise 0." },
            minutes: { type: "integer", description: "wait: minutes to wait (1440 = 1 day). condition watched_within: the time window in minutes. Otherwise 0." },
            check: { type: "string", enum: CHECKS, description: "condition only; otherwise none." },
            template: str("template only: the template name. Otherwise empty."),
            media: str("message/language: none, banner_wa, poster, square, banner_wide, trailer, episode:N (that episode's chat clip) or a media library id. link: none, banner_wa, poster, square, banner_wide or an image id. Otherwise none."),
            skip: {
              type: "boolean",
              description:
                "language: skip for viewers who already chose. optin: skip for viewers who already answered. episode: skip if the viewer already watched it (usually true). link: open where the viewer left off if further (usually true). Otherwise false.",
            },
          },
        },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Canvas ↔ steps
// ---------------------------------------------------------------------------

const target = (g: FlowGraph, id: string, port: string) => g.edges.find((e) => e.source === id && e.sourceHandle === port)?.target ?? "";
const mediaKey = (m: MediaRef | null) =>
  !m ? "none" : "assetId" in m ? m.assetId : m.source === "series" ? m.slot : m.source === "episode" ? `episode:${m.episode}` : m.source;

export function graphToSteps(g: FlowGraph): Step[] {
  return g.nodes.map((n) => {
    const d = n.data;
    const s: Step = { id: n.id, kind: d.kind, ar: "", en: "", buttons: [], next: "", yes: "", no: "", episode: 0, minutes: 0, check: "none", template: "", media: "none", skip: false };
    switch (d.kind) {
      case "start":
      case "web":
        s.next = target(g, n.id, "next");
        break;
      case "message":
        Object.assign(s, { ar: d.body.ar, en: d.body.en, media: mediaKey(d.media) });
        s.buttons = d.buttons.map((b) => ({ ar: b.title.ar, en: b.title.en, goto: target(g, n.id, b.id) }));
        if (!d.buttons.length) s.next = target(g, n.id, "next");
        break;
      case "language":
        Object.assign(s, { ar: d.body.ar, media: mediaKey(d.media), skip: d.skipIfKnown });
        s.buttons = [
          { ar: d.btnAr, en: "", goto: target(g, n.id, "ar") },
          { ar: d.btnEn, en: d.btnEn, goto: target(g, n.id, "en") },
        ];
        break;
      case "episode":
        Object.assign(s, { ar: d.caption.ar, en: d.caption.en, episode: d.episode, skip: d.skipIfWatched });
        s.buttons = d.buttons.map((b) => ({ ar: b.title.ar, en: b.title.en, goto: target(g, n.id, b.id) }));
        if (!d.buttons.length) s.next = target(g, n.id, "next");
        break;
      case "link":
        Object.assign(s, { ar: d.body.ar, en: d.body.en, episode: d.episode === "resume" ? 0 : d.episode, media: mediaKey(d.media), next: target(g, n.id, "next"), skip: d.resumeIfFurther });
        s.buttons = [{ ar: d.button.ar, en: d.button.en, goto: "" }];
        break;
      case "optin":
        Object.assign(s, { ar: d.body.ar, en: d.body.en, skip: d.skipIfAnswered });
        s.buttons = [
          { ar: d.yes.ar, en: d.yes.en, goto: target(g, n.id, "yes") },
          { ar: d.no.ar, en: d.no.en, goto: target(g, n.id, "no") },
        ];
        break;
      case "wait":
        Object.assign(s, { minutes: d.minutes, next: target(g, n.id, "next") });
        break;
      case "condition":
        Object.assign(s, {
          check: d.condition.check,
          episode: d.condition.check === "reached_episode" ? d.condition.episode : 0,
          minutes: d.condition.check === "watched_within" ? d.condition.hours * 60 : 0,
          yes: target(g, n.id, "yes"),
          no: target(g, n.id, "no"),
        });
        break;
      case "template":
        Object.assign(s, { template: d.name, next: target(g, n.id, "next") });
        break;
      case "choice":
        Object.assign(s, { ar: d.body.ar, en: d.body.en, media: mediaKey(d.media) });
        s.buttons = d.options.map((o) => ({ ar: o.label.ar, en: o.label.en, goto: o.code }));
        break;
    }
    return s;
  });
}

function toMedia(key: string, ctx: AgentContext, imageOnly: boolean): MediaRef | null {
  const k = key.trim().toLowerCase();
  if (!k || k === "none") return null;
  if (k === "poster" || k === "banner_wa" || k === "banner_wide" || k === "square") return { source: "series", slot: k, type: "image" };
  if (k === "trailer") return imageOnly ? null : { source: "trailer", type: "video" };
  const ep = /^episode:(\d+)$/.exec(k);
  if (ep) return imageOnly ? null : { source: "episode", episode: Number(ep[1]), type: "video" };
  const a = ctx.assets.find((x) => x.id === key.trim());
  if (!a || (imageOnly && a.kind !== "image")) return null;
  return { assetId: a.id, url: a.url, type: a.kind, name: a.name };
}

/** Turn the AI's steps into cards and arrows. Existing cards keep their place on the canvas. */
export function stepsToGraph(steps: Step[], ctx: AgentContext, previous: FlowGraph | null): FlowGraph {
  // Stable, unique ids.
  const idMap = new Map<string, string>();
  for (const s of steps) {
    const want = typeof s.id === "string" && ID.test(s.id) && ![...idMap.values()].includes(s.id) ? s.id : newId();
    if (!idMap.has(s.id)) idMap.set(s.id, want);
  }
  const ref = (id: string) => (id ? (idMap.get(id) ?? null) : null);

  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const link = (source: string, port: string, to: string) => {
    const t = ref(to);
    if (t && !edges.some((e) => e.source === source && e.sourceHandle === port)) edges.push({ id: newId(), source, sourceHandle: port, target: t });
  };
  const prevNode = (id: string) => previous?.nodes.find((n) => n.id === id);
  let starts = 0;
  let webs = 0;

  for (const s of steps) {
    const kind = String(s.kind).toLowerCase() as NodeKind;
    if (!KINDS.includes(kind)) continue;
    if (kind === "start" && starts++) continue; // only one start
    if (kind === "web" && webs++) continue; // and one web entry
    const id = idMap.get(s.id)!;
    if (nodes.some((n) => n.id === id)) continue;
    const bi = { ar: s.ar ?? "", en: s.en ?? "" };
    const old = prevNode(id)?.data;
    const oldButtons = old && (old.kind === "message" || old.kind === "episode") ? old.buttons : [];
    const buttons = (s.buttons ?? []).slice(0, LIMITS.maxButtons).map((b, i) => ({ id: oldButtons[i]?.id ?? `b${i + 1}`, title: { ar: b.ar ?? "", en: b.en ?? "" }, goto: b.goto ?? "" }));
    const ep = Math.max(1, Math.min(Math.round(s.episode || 1), Math.max(ctx.episodeCount, 1)));
    let data: NodeData;
    switch (kind) {
      case "start":
      case "web":
        data = { kind };
        link(id, "next", s.next);
        break;
      case "message":
        data = { kind, body: bi, buttons: buttons.map(({ id: bid, title }) => ({ id: bid, title })), media: toMedia(s.media, ctx, false) };
        if (buttons.length) buttons.forEach((b) => link(id, b.id, b.goto));
        else link(id, "next", s.next);
        break;
      case "language":
        data = { kind, body: { ar: s.ar, en: s.ar }, btnAr: buttons[0]?.title.ar || "عربي", btnEn: buttons[1]?.title.ar || buttons[1]?.title.en || "English subtitles", skipIfKnown: s.skip !== false, media: toMedia(s.media, ctx, false) };
        link(id, "ar", buttons[0]?.goto ?? s.next);
        link(id, "en", buttons[1]?.goto ?? s.next);
        break;
      case "episode":
        data = { kind, episode: ep, caption: bi, buttons: buttons.map(({ id: bid, title }) => ({ id: bid, title })), skipIfWatched: s.skip !== false };
        if (buttons.length) buttons.forEach((b) => link(id, b.id, b.goto));
        else link(id, "next", s.next);
        break;
      case "link":
        data = {
          kind,
          episode: s.episode > 0 ? ep : "resume",
          body: bi,
          button: { ar: buttons[0]?.title.ar || "شاهد الآن", en: buttons[0]?.title.en || "Watch now" },
          media: toMedia(s.media, ctx, true),
          resumeIfFurther: s.skip !== false,
        };
        link(id, "next", s.next);
        break;
      case "optin":
        data = { kind, body: bi, yes: buttons[0]?.title ?? { ar: "نعم", en: "Yes" }, no: buttons[1]?.title ?? { ar: "لا", en: "No" }, skipIfAnswered: s.skip !== false };
        link(id, "yes", buttons[0]?.goto ?? "");
        link(id, "no", buttons[1]?.goto ?? "");
        break;
      case "wait":
        data = { kind, minutes: Math.max(1, Math.min(Math.round(s.minutes || 60), 43200)) };
        link(id, "next", s.next);
        break;
      case "condition": {
        const check = String(s.check).toLowerCase();
        const condition: Condition =
          check === "reached_episode"
            ? { check: "reached_episode", episode: ep }
            : check === "watched_within"
              ? { check: "watched_within", hours: Math.max(1, Math.min(720, Math.round((s.minutes || 1440) / 60))) }
              : check === "language_en" || check === "paid" || check === "started"
                ? { check }
                : { check: "opted_in" };
        data = { kind, condition };
        link(id, "yes", s.yes);
        link(id, "no", s.no);
        break;
      }
      case "template":
        data = { kind, name: /^[a-z0-9_]{1,512}$/.test(s.template) ? s.template : "" };
        link(id, "next", s.next);
        break;
      case "choice": {
        const known = new Set((ctx.otherSeries ?? []).map((o) => o.code));
        const options = (s.buttons ?? []).slice(0, 3).map((b) => {
          const code = String(b.goto ?? "").trim().toUpperCase();
          return { code: known.has(code) ? code : "AUTO", label: { ar: b.ar ?? "", en: b.en ?? "" } };
        });
        data = { kind, body: bi, options: options.length ? options : [{ code: "AUTO", label: { ar: "", en: "" } }], media: toMedia(s.media, ctx, false) };
        break;
      }
      default:
        data = { kind: "suggest" };
    }
    const keptName = prevNode(id)?.name;
    nodes.push({ id, position: prevNode(id)?.position ?? { x: 0, y: 0 }, data, ...(keptName ? { name: keptName } : {}) });
  }
  if (!nodes.some((n) => n.data.kind === "start")) nodes.unshift({ id: newId(), position: { x: 0, y: 0 }, data: { kind: "start" } });
  layoutNew(nodes, edges, new Set(previous?.nodes.map((n) => n.id) ?? []));
  return { v: 1, nodes, edges };
}

/** Place cards that weren't on the canvas: left to right by distance from Start, stacked within a column. */
function layoutNew(nodes: FlowNode[], edges: FlowEdge[], kept: Set<string>) {
  const entries = nodes.filter((n) => n.data.kind === "start" || n.data.kind === "web");
  const depth = new Map<string, number>(entries.map((n) => [n.id, 0]));
  const queue = entries.map((n) => n.id);
  while (queue.length) {
    const id = queue.shift()!;
    for (const e of edges.filter((x) => x.source === id)) if (!depth.has(e.target)) (depth.set(e.target, depth.get(id)! + 1), queue.push(e.target));
  }
  const used = new Map<string, number>();
  const maxY = Math.max(0, ...nodes.filter((n) => kept.has(n.id)).map((n) => n.position.y));
  for (const n of nodes) {
    if (kept.has(n.id)) continue;
    const d = depth.get(n.id) ?? 0;
    const col = `${d}`;
    const row = used.get(col) ?? 0;
    used.set(col, row + 1);
    n.position = { x: d * 330, y: (kept.size ? maxY + 420 : 0) + row * 380 };
  }
}

// ---------------------------------------------------------------------------
// Instructions and checks
// ---------------------------------------------------------------------------

export function flowSystemPrompt(ctx: AgentContext): string {
  const kinds = KINDS.map((k) => `- ${k}: ${CARD_LABELS[k]}`).join("\n");
  return `You design WhatsApp chat flows for Watchat, an Arabic-first micro-drama service. A viewer sends the series code in WhatsApp,
gets a few short episodes in the chat with cliffhangers, then a personal link to keep watching on the web (episodes after the free ones cost coins).

Series: ${ctx.code} · "${ctx.titleAr}" / "${ctx.titleEn}" · ${ctx.episodeCount} episodes
Chat clips uploaded for episodes: ${ctx.clips.length ? ctx.clips.join(", ") : "none yet"} · poster: ${ctx.hasPoster ? "yes" : "no"} · trailer: ${ctx.hasTrailer ? "yes" : "no"}
Media library: ${ctx.assets.length ? ctx.assets.map((a) => `${a.id} = ${a.kind} "${a.name}"`).join("; ") : "empty"}
Other live series (for choice steps): ${ctx.otherSeries?.length ? ctx.otherSeries.map((o) => `${o.code} "${o.titleAr}" / "${o.titleEn}"`).join("; ") : "none yet"}
Templates (for messages 24 h+ after the viewer's last message): ${ctx.templates.length ? ctx.templates.map((t) => `${t.name} (${t.approved ? "approved" : "not approved yet"})${t.bodyAr ? `: ${t.bodyAr}` : ""}`).join("; ") : "none"}

Step kinds:
${kinds}

Rules (the flow is checked against these before it can be published):
- Exactly one start step (the viewer sends the code). Optionally one web step: runs when the viewer starts watching on the web, for follow-ups.
- Viewers can watch ahead on the web: episode steps with skip=true are skipped for episodes already watched, and links with skip=true open where the viewer left off. Use the started condition to treat returning viewers differently, and watched_within to avoid reminding people who are watching right now.
- Every step id must be unique; goto/next/yes/no must name existing steps or be empty (ends the chat).
- Reply buttons: at most ${LIMITS.maxButtons} per step, titles at most ${LIMITS.buttonTitle} characters including emoji, all different within a step. Messages at most ${LIMITS.body} characters.
- Placeholders allowed in texts: {title} series title, {n} episode number, {total} episode count, {next} episode a link opens, {tagline} series tagline, {genre} genres, {cast} main cast. Nothing else in curly braces.
- Prefer banner_wa for images on message and link cards (it is sized for WhatsApp).
- Arabic is the main language: natural Gulf Arabic, short, suspenseful, a hook in every message. English is for viewers with English subtitles.
- WhatsApp's 24-hour rule: after a wait of 23 hours or more, only template steps (optionally through condition/wait) may follow. Use only approved template names when possible.
- Marketing templates only reach viewers who turned on alerts, so ask for alerts (optin) before relying on them.
- No links, phone numbers or prices in texts; the link step creates the personal link.
- Episode steps only for episodes that exist; prefer ones with clips uploaded, and mention missing clips in notes.
- When changing an existing flow, keep the ids and texts of steps you don't need to change.
Answer only by calling write_flow with the complete flow.`;
}

export function scriptIssues(g: FlowGraph, ctx: AgentContext): Issue[] {
  const v: ValidateCtx = {
    episodeCount: ctx.episodeCount,
    templates: ctx.templates.map((t) => ({ name: t.name, approved: t.approved })),
    seriesCodes: ctx.otherSeries?.map((o) => o.code),
  };
  return validateFlow(g, v);
}

export function parseScript(raw: unknown): FlowScript {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const steps = Array.isArray(o.steps) ? (o.steps as Step[]).filter((s) => s && typeof s === "object").slice(0, 120) : [];
  return { summary: String(o.summary ?? "").slice(0, 1500), notes: String(o.notes ?? "").slice(0, 1500), steps };
}
