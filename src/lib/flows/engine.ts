// Runs a flow. Pure: every side effect goes through FlowEnv, so the same code drives the real bot
// (server, WhatsApp + database) and the editor's live chat preview (browser, in memory).

import { renderCopy, type CopyVars } from "../bot/copy";
import type { OutMessage } from "../whatsapp/messages";
import { buttonReplyId, isFreeform, waitsForInput, type Condition, type FlowGraph, type FlowNode, type Lang, type MediaRef } from "./types";

export interface FlowEnv {
  lang: Lang;
  title(lang: Lang): string;
  totalEpisodes: number;
  send(msg: OutMessage, nodeId: string): Promise<void>;
  knownLanguage(): Lang | null;
  setLanguage(lang: Lang): Promise<void>;
  optIn(): Promise<"in" | "out" | null>;
  setOptIn(yes: boolean): Promise<void>;
  /** Personal link. resumeIfFurther: open where the viewer left off when that's past `episode`. */
  link(episode: number | "resume", resumeIfFurther: boolean): Promise<{ url: string; episode: number }>;
  /** What the viewer has watched of this series: chat episodes received count as completed. */
  progress(): Promise<SeriesProgress>;
  /** Record that an episode was sent in the chat. */
  noteChatEpisode(episode: number): void;
  clip(episode: number, lang: Lang): Promise<{ url: string | null; title: string | null }>;
  mediaUrl(ref: MediaRef): string | null;
  template(name: string, nodeId: string): Promise<"sent" | "skipped" | "failed">;
  check(condition: Condition): Promise<boolean>;
  suggest(): Promise<void>;
  /** False once 24 h have passed since the viewer's last message: only templates may be sent. */
  canSendFreeform(): boolean;
  track(name: string, data?: { episode?: number; props?: Record<string, unknown> }): Promise<void>;
  now(): number;
}

export type SeriesProgress = { maxStarted: number; maxCompleted: number; lastWatchedAt: number | null };

/** Already seen: completed, sent in the chat, or the viewer has moved past it. */
export const hasWatched = (p: SeriesProgress, episode: number) => episode <= p.maxCompleted || episode < p.maxStarted;

export type RunResult =
  | { status: "input"; nodeId: string }
  | { status: "wait"; nodeId: string; resumeAt: number }
  | { status: "done" }
  | { status: "blocked"; nodeId: string; reason: string };

const MAX_STEPS = 40;

/** Text in the viewer's language; Arabic when the English one is empty. */
export const pick = (b: { ar: string; en: string }, lang: Lang) => (b[lang] ?? "").trim() || b.ar;

export const findStart = (g: FlowGraph) => g.nodes.find((n) => n.data.kind === "start") ?? null;
const nodeById = (g: FlowGraph, id: string) => g.nodes.find((n) => n.id === id) ?? null;
export const nextOf = (g: FlowGraph, nodeId: string, port: string) => g.edges.find((e) => e.source === nodeId && e.sourceHandle === port)?.target ?? null;

function header(env: FlowEnv, media: MediaRef | null) {
  const link = media ? env.mediaUrl(media) : null;
  return link && media ? { type: media.type, link } : null;
}

/** Execute cards starting at `nodeId` until one waits for the viewer, waits for time, or the flow ends. */
export async function runFrom(g: FlowGraph, nodeId: string | null, env: FlowEnv): Promise<RunResult> {
  let id = nodeId;
  for (let step = 0; id && step < MAX_STEPS; step++) {
    const node = nodeById(g, id);
    if (!node) return { status: "done" };
    if (isFreeform(node.data) && !env.canSendFreeform()) {
      return { status: "blocked", nodeId: node.id, reason: "More than 24 hours since the viewer's last message: only templates can be sent." };
    }
    const r = await execute(g, node, env);
    if (r.stop) return r.stop;
    id = r.next;
  }
  return { status: "done" };
}

async function execute(g: FlowGraph, node: FlowNode, env: FlowEnv): Promise<{ next: string | null; stop?: RunResult }> {
  const d = node.data;
  const lang = env.lang;
  const vars: CopyVars = { title: env.title(lang), total: env.totalEpisodes };
  const next = (port = "next") => ({ next: nextOf(g, node.id, port) });
  const input = { next: null, stop: { status: "input", nodeId: node.id } as RunResult };

  switch (d.kind) {
    case "start":
    case "web":
      return next();

    case "message": {
      const body = renderCopy(pick(d.body, lang), vars);
      const h = header(env, d.media);
      if (d.buttons.length) {
        await env.send(
          { kind: "buttons", body, buttons: d.buttons.map((b) => ({ id: buttonReplyId(node.id, b.id), title: pick(b.title, lang) })), ...(h ? { header: h } : {}) },
          node.id,
        );
        return input;
      }
      await env.send(h ? { kind: h.type, link: h.link, caption: body || undefined } : { kind: "text", body }, node.id);
      return next();
    }

    case "language": {
      const known = env.knownLanguage();
      if (d.skipIfKnown && known) return next(known);
      const h = header(env, d.media);
      await env.send(
        {
          kind: "buttons",
          body: renderCopy(d.body.ar, { ...vars, title: `${env.title("ar")} · ${env.title("en")}` }),
          buttons: [
            { id: buttonReplyId(node.id, "ar"), title: d.btnAr },
            { id: buttonReplyId(node.id, "en"), title: d.btnEn },
          ],
          ...(h ? { header: h } : {}),
        },
        node.id,
      );
      return input;
    }

    case "episode": {
      if (d.skipIfWatched && hasWatched(await env.progress(), d.episode)) {
        return next(d.buttons[0]?.id ?? "next"); // already seen: continue as if they tapped the first button
      }
      const clip = await env.clip(d.episode, lang);
      const caption = renderCopy(pick(d.caption, lang), { ...vars, n: d.episode, title: clip.title ?? vars.title });
      if (d.buttons.length) {
        await env.send(
          {
            kind: "buttons",
            body: caption,
            buttons: d.buttons.map((b) => ({ id: buttonReplyId(node.id, b.id), title: pick(b.title, lang) })),
            ...(clip.url ? { header: { type: "video" as const, link: clip.url } } : {}),
          },
          node.id,
        );
      } else {
        await env.send(clip.url ? { kind: "video", link: clip.url, caption } : { kind: "text", body: caption }, node.id);
      }
      env.noteChatEpisode(d.episode);
      await env.track("wa_episode_sent", { episode: d.episode });
      return d.buttons.length ? input : next();
    }

    case "link": {
      const { url, episode } = await env.link(d.episode, d.resumeIfFurther);
      const h = header(env, d.media);
      await env.send(
        {
          kind: "cta_url",
          body: renderCopy(pick(d.body, lang), { ...vars, n: episode, next: episode }),
          buttonText: renderCopy(pick(d.button, lang), { n: episode, next: episode }),
          url,
          ...(h && h.type === "image" ? { header: h } : {}),
        },
        node.id,
      );
      await env.track("link_sent", { episode, props: { purpose: "flow" } });
      return next();
    }

    case "optin": {
      if (d.skipIfAnswered) {
        const current = await env.optIn();
        if (current !== null) return next(current === "in" ? "yes" : "no");
      }
      await env.send(
        {
          kind: "buttons",
          body: renderCopy(pick(d.body, lang), vars),
          buttons: [
            { id: buttonReplyId(node.id, "yes"), title: pick(d.yes, lang) },
            { id: buttonReplyId(node.id, "no"), title: pick(d.no, lang) },
          ],
        },
        node.id,
      );
      return input;
    }

    case "wait":
      return { next: null, stop: { status: "wait", nodeId: node.id, resumeAt: env.now() + Math.max(1, d.minutes) * 60_000 } };

    case "condition":
      return next((await env.check(d.condition)) ? "yes" : "no");

    case "template":
      await env.template(d.name, node.id);
      return next();

    case "suggest":
      await env.suggest();
      return { next: null, stop: { status: "done" } };
  }
}

/** Start the flow from its Start card (the viewer sent the code) or its On the web card. */
export async function startFlow(g: FlowGraph, env: FlowEnv, entry: "chat" | "web" = "chat"): Promise<RunResult> {
  const card = entry === "web" ? g.nodes.find((n) => n.data.kind === "web") : findStart(g);
  return card ? runFrom(g, card.id, env) : { status: "done" };
}

export const hasWebEntry = (g: FlowGraph) => g.nodes.some((n) => n.data.kind === "web");

/** The viewer tapped a button (port) on a card. Old buttons still work as long as the card exists. */
export async function answer(g: FlowGraph, nodeId: string, port: string, env: FlowEnv): Promise<RunResult> {
  const node = nodeById(g, nodeId);
  if (!node || !waitsForInput(node.data)) return { status: "done" };
  if (node.data.kind === "language" && (port === "ar" || port === "en")) {
    await env.setLanguage(port);
    env.lang = port;
  }
  if (node.data.kind === "optin" && (port === "yes" || port === "no")) await env.setOptIn(port === "yes");
  return runFrom(g, nextOf(g, nodeId, port), env);
}

/** A Wait card's time is up: continue after it. */
export async function resumeAfterWait(g: FlowGraph, waitNodeId: string, env: FlowEnv): Promise<RunResult> {
  return runFrom(g, nextOf(g, waitNodeId, "next"), env);
}
