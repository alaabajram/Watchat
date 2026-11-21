// The WhatsApp bot as a small state machine.
// Everything that touches the database or Meta goes through `BotDeps`, so the flow is easy to test
// (see flow.test.ts) and easy to re-host for a partner brand.
//
// A series code starts the series' flow (Flow builder; the standard flow is published automatically
// when none exists) and button taps move through it. Words like ابدأ, رابط, حسابي, STOP run the shared
// flow (Flow builder → Shared replies), built on the canvas; the built-in replies below are the safety net
// (STOP and data deletion always work) and handle old menu buttons.

import type { MsgRef } from "../ctr/ctr";
import { answer, runFrom, startFlow, type FlowEnv, type RunResult, type SeriesProgress } from "../flows/engine";
import { matchKeyword } from "../flows/shared";
import { artUrl, metaVars, type SeriesMeta } from "../flows/meta";
import { sharedReplyId, type Condition, type FlowGraph, type Lang, type SharedAction } from "../flows/types";
import type { InboundMessage } from "../whatsapp/inbound";
import type { OutMessage } from "../whatsapp/messages";
import { makeT, type CopyLang, type CopyOverrides, type T } from "./copy";
import { IDS, parseIntent, type Intent } from "./intents";

export type ViewerLang = "ar" | "ar_en_subs";

export type Viewer = {
  id: string;
  waId: string;
  language: ViewerLang | null;
  /** The one-time "pin this message · your account: watchat.pro/me" tip was already added to a link. */
  pinHintSent?: boolean;
};

export type Series = {
  id: string;
  code: string;
  titleAr: string;
  titleEn: string;
  posterUrl: string | null;
  trailerUrl: string | null;
  episodeCount: number;
  waEpisodeCount: number; // episodes the standard flow sends inside the chat (default 3)
  art?: { bannerWa: string | null; bannerWide: string | null; square: string | null };
  meta?: SeriesMeta;
};

export type Clip = {
  number: number;
  titleAr: string | null;
  titleEn: string | null;
  videoUrlAr: string | null;
  videoUrlEn: string | null;
};

export type ChatStep = "idle" | "lang" | "trailer" | "episodes" | "linked" | "flow";
export type ChatState = { seriesId: string | null; step: ChatStep; waEpisode: number };

export type EventName =
  | "chat_started"
  | "wa_episode_sent"
  | "wa_episode_done"
  | "wa_dropout"
  | "link_sent"
  | "opt_in_changed"
  | "language_set"
  | "data_deletion_requested"
  | "device_confirmed"
  | "flow_started"
  | "flow_blocked"
  | "growth_picks_opened"
  | "flow_tap";

/** Where a viewer is in one series' flow (a viewer has one per series they've started). */
export type FlowRun = {
  seriesId: string;
  versionId: string;
  nodeId: string;
  status: "input" | "wait" | "running" | "done" | "blocked" | "paused";
  resumeAt: string | null;
  entry: "chat" | "web"; // how this run last began: the series code, or watching on the web
  chatEpisode: number; // furthest episode sent in the chat
  webTriggeredAt?: string | null;
};

export interface BotDeps {
  upsertViewer(msg: InboundMessage): Promise<Viewer>;
  getChatState(viewerId: string): Promise<ChatState>;
  saveChatState(viewerId: string, state: ChatState): Promise<void>;
  setViewerLanguage(viewerId: string, lang: ViewerLang): Promise<void>;
  findSeriesByCode(code: string): Promise<Series | null>;
  getSeries(seriesId: string): Promise<Series | null>;
  getClip(seriesId: string, episodeNumber: number): Promise<Clip | null>;
  listOtherSeries(excludeSeriesId: string | null): Promise<Series[]>;
  getOptIn(viewerId: string): Promise<"in" | "out" | null>;
  setOptIn(viewerId: string, status: "in" | "out", source: string): Promise<void>;
  /** Admin overrides of bot texts (defaults first, then the series' own). */
  getCopyOverrides(seriesId: string | null, lang: CopyLang): Promise<CopyOverrides>;
  /** Mark the browser session waiting for this code as trusted. */
  confirmSpendCode(viewerId: string, code: string): Promise<boolean>;
  /** Web episode the viewer should land on (first unwatched, at least the one after the chat episodes). */
  resumeEpisode(viewerId: string, series: Series): Promise<number>;
  /** Create a personal signed link and return its full URL. */
  mintLink(viewerId: string, series: Series, episodeNumber: number): Promise<string>;
  /** A personal sign-in link that opens "My account" (/me). */
  mintAccountLink(viewerId: string): Promise<string>;
  /** The fixed account address everyone keeps (watchat.pro/me). */
  accountUrl(): Promise<string>;
  markPinHintSent(viewerId: string): Promise<void>;
  /** `ref` says which flow card (or other sender) this is, for the CTR meters. */
  send(to: string, msg: OutMessage, ref?: MsgRef): Promise<void>;
  /** The series' live flow; the standard flow is published automatically if none exists. Null only if the series is gone. */
  getPublishedFlow(seriesId: string): Promise<{ versionId: string; graph: FlowGraph } | null>;
  getFlowVersion(versionId: string): Promise<FlowGraph | null>;
  /** The published Shared replies flow (the standard one, with saved texts, until the team publishes their own). */
  getSharedFlow(): Promise<FlowGraph>;
  getFlowRun(viewerId: string, seriesId: string): Promise<FlowRun | null>;
  /** The viewer's runs, most recently active first. */
  listFlowRuns(viewerId: string): Promise<FlowRun[]>;
  saveFlowRun(viewerId: string, run: FlowRun): Promise<void>;
  /** The viewer moved to another series: hold that series' waiting follow-ups. */
  pauseOtherRuns(viewerId: string, activeSeriesId: string): Promise<void>;
  /** What the viewer watched of a series on the web. */
  seriesProgress(viewerId: string, seriesId: string): Promise<SeriesProgress>;
  /** Send an approved template (respects opt-in and the marketing frequency cap). */
  sendFlowTemplate(viewer: Viewer, series: Series, name: string, nodeId?: string): Promise<"sent" | "skipped" | "failed">;
  checkCondition(viewer: Viewer, series: Series, condition: Condition): Promise<boolean>;
  /** Series codes the growth agent picked for this viewer (marks the suggestion as answered). */
  getGrowthPicks(viewerId: string, suggestionId: string): Promise<string[] | null>;
  track(
    viewerId: string,
    name: EventName,
    data?: { seriesId?: string; episode?: number; props?: Record<string, unknown> },
  ): Promise<void>;
}

export const EMPTY_STATE: ChatState = { seriesId: null, step: "idle", waEpisode: 0 };

const langOf = (v: Viewer): CopyLang => (v.language === "ar_en_subs" ? "en" : "ar");
const titleOf = (s: Series, lang: CopyLang) => (lang === "en" ? s.titleEn : s.titleAr);

type Ctx = { viewer: Viewer; deps: BotDeps; lang: CopyLang; t: T };

async function ctxFor(viewer: Viewer, series: Series | null, deps: BotDeps): Promise<Ctx> {
  const lang = langOf(viewer);
  return { viewer, deps, lang, t: makeT(lang, await deps.getCopyOverrides(series?.id ?? null, lang)) };
}

/** Handle one inbound WhatsApp message end to end. */
export async function handleInbound(msg: InboundMessage, baseDeps: BotDeps): Promise<void> {
  const viewer = await baseDeps.upsertViewer(msg);
  const deps = withPinHint(viewer, baseDeps);
  const state = await deps.getChatState(viewer.id);
  const intent = parseIntent(msg);
  if (await routeShared(intent, viewer, state, msg, deps)) return;
  const next = await route(intent, viewer, state, msg, deps);
  if (next) await deps.saveChatState(viewer.id, next);
}

/** Intents a "Viewer sends" card may answer (series codes, links from the web and flow buttons never go here). */
const SHARED_INTENTS = new Set<Intent["type"]>(["menu", "link", "account", "stop", "delete_data", "unknown"]);

/**
 * Shared replies built on the canvas. Returns true when the shared flow answered.
 * An exact word on a "Viewer sends" card wins; STOP and data deletion fall back to the built-in replies
 * when no card has those words; anything else goes to the "anything else" card.
 */
async function routeShared(intent: Intent, viewer: Viewer, state: ChatState, msg: InboundMessage, deps: BotDeps): Promise<boolean> {
  const tap = intent.type === "shared_reply" ? intent : null;
  if (!tap && !(msg.kind === "text" && SHARED_INTENTS.has(intent.type))) return false;
  const graph = await deps.getSharedFlow();
  const current = state.seriesId ? await deps.getSeries(state.seriesId) : null;
  const env = sharedEnvFor(viewer, current, deps);

  if (tap) {
    if (!graph.nodes.some((n) => n.id === tap.nodeId)) return false; // card removed since: the built-in menu answers
    await answer(graph, tap.nodeId, tap.port, env);
    return true;
  }
  const exact = matchKeyword(graph, msg.text ?? "", { allowCatchAll: false });
  const card = exact ?? (intent.type === "stop" || intent.type === "delete_data" ? null : matchKeyword(graph, "", { allowCatchAll: true }));
  if (!card) return false;
  if (!exact && !current && intent.type === "unknown") {
    const { t } = await ctxFor(viewer, null, deps);
    await deps.send(viewer.waId, { kind: "text", body: t("needSeriesFirst") });
  }
  await runFrom(graph, card.id, env);
  return true;
}

/**
 * The first personal link a viewer gets also invites them to pin it and shows the fixed account
 * address (watchat.pro/me), so they can come back on their own without a message from us.
 */
function withPinHint(viewer: Viewer, deps: BotDeps): BotDeps {
  if (viewer.pinHintSent) return deps;
  return {
    ...deps,
    async send(to, m, ref) {
      if (viewer.pinHintSent || m.kind !== "cta_url" || !m.url.includes("/w/")) return deps.send(to, m, ref);
      const { t } = await ctxFor(viewer, null, deps);
      await deps.send(to, { ...m, body: `${m.body}\n\n${t("pinHint")}` }, ref);
      viewer.pinHintSent = true;
      await deps.markPinHintSent(viewer.id);
    },
  };
}

async function route(
  intent: Intent,
  viewer: Viewer,
  state: ChatState,
  msg: InboundMessage,
  deps: BotDeps,
): Promise<ChatState | null> {
  const current = state.seriesId ? await deps.getSeries(state.seriesId) : null;
  const c = await ctxFor(viewer, current, deps);
  const { t } = c;
  const to = viewer.waId;

  switch (intent.type) {
    case "series_code": {
      const series = await deps.findSeriesByCode(intent.code);
      if (!series) {
        await deps.send(to, { kind: "text", body: t("seriesNotFound") });
        return null;
      }
      await deps.track(viewer.id, "chat_started", {
        seriesId: series.id,
        props: { code: series.code, source: msg.referral ? "ctwa_ad" : "organic", referral: msg.referral ?? null },
      });
      const flow = await deps.getPublishedFlow(series.id);
      if (!flow) {
        await deps.send(to, { kind: "text", body: t("seriesNotFound") });
        return null;
      }
      // Each series keeps its own place; the flow itself skips what the viewer already watched.
      const previous = await deps.getFlowRun(viewer.id, series.id);
      await deps.pauseOtherRuns(viewer.id, series.id);
      await deps.track(viewer.id, "flow_started", { seriesId: series.id, props: { version: flow.versionId, returning: Boolean(previous) } });
      const run = { chatEpisode: previous?.chatEpisode ?? 0 };
      const result = await startFlow(flow.graph, flowEnvFor(viewer, series, deps, { canSendFreeform: true, run }));
      await saveRunResult(deps, viewer, series.id, flow.versionId, result, { entry: "chat", chatEpisode: run.chatEpisode, webTriggeredAt: previous?.webTriggeredAt ?? null });
      return { seriesId: series.id, step: "flow", waEpisode: 0 };
    }

    case "language": {
      await deps.setViewerLanguage(viewer.id, intent.lang);
      await deps.track(viewer.id, "language_set", { props: { language: intent.lang } });
      await sendMenu(await ctxFor({ ...viewer, language: intent.lang }, current, deps));
      return null;
    }

    case "next_episode": {
      // "Start" / "Next" on a message from before flows: send the viewer's link to where they are.
      if (!current) {
        await deps.send(to, { kind: "text", body: t("needSeriesFirst") });
        return null;
      }
      await sendPlayerLink(c, current);
      return null;
    }

    case "not_for_me": {
      await deps.track(viewer.id, "wa_dropout", { seriesId: current?.id, episode: state.waEpisode });
      await sendSuggestions(c, current);
      return null;
    }

    case "flow_reply": {
      // Find the series whose flow has the tapped card (the viewer may be in several series).
      let found: { run: FlowRun; graph: FlowGraph } | null = null;
      for (const r of await deps.listFlowRuns(viewer.id)) {
        const graph = await deps.getFlowVersion(r.versionId);
        if (graph?.nodes.some((n) => n.id === intent.nodeId)) {
          found = { run: r, graph };
          break;
        }
      }
      const series = found ? await deps.getSeries(found.run.seriesId) : null;
      if (!found || !series) {
        await sendMenu(c);
        return null;
      }
      await deps.pauseOtherRuns(viewer.id, series.id);
      await deps.track(viewer.id, "flow_tap", { seriesId: series.id, props: { node: intent.nodeId, port: intent.port } });
      const run = { chatEpisode: found.run.chatEpisode };
      const result = await answer(found.graph, intent.nodeId, intent.port, flowEnvFor(viewer, series, deps, { canSendFreeform: true, run }));
      await saveRunResult(deps, viewer, series.id, found.run.versionId, result, { entry: found.run.entry, chatEpisode: run.chatEpisode, webTriggeredAt: found.run.webTriggeredAt ?? null });
      return { seriesId: series.id, step: "flow", waEpisode: 0 };
    }

    case "opt_in": {
      await deps.setOptIn(viewer.id, intent.yes ? "in" : "out", "button");
      await deps.track(viewer.id, "opt_in_changed", { props: { status: intent.yes ? "in" : "out", source: "button" } });
      await deps.send(to, { kind: "text", body: intent.yes ? t("optInConfirmed") : t("optInDeclined") });
      return null;
    }

    case "stop": {
      await deps.setOptIn(viewer.id, "out", "stop_command");
      await deps.track(viewer.id, "opt_in_changed", { props: { status: "out", source: "stop_command" } });
      await deps.send(to, { kind: "buttons", body: t("stopConfirmed"), buttons: [{ id: IDS.optInYes, title: t("btnAlertsOn") }] });
      return null;
    }

    case "toggle_alerts": {
      if ((await deps.getOptIn(viewer.id)) === "in") {
        await deps.setOptIn(viewer.id, "out", "menu");
        await deps.track(viewer.id, "opt_in_changed", { props: { status: "out", source: "menu" } });
        await deps.send(to, { kind: "buttons", body: t("stopConfirmed"), buttons: [{ id: IDS.optInYes, title: t("btnAlertsOn") }] });
      } else {
        await sendOptInAsk(c);
      }
      return null;
    }

    case "link": {
      if (!current) {
        await sendAccountLink(c);
        return null;
      }
      await sendPlayerLink(c, current);
      return null;
    }

    case "account": {
      await sendAccountLink(c);
      return null;
    }

    case "watch": {
      // Someone continuing from a shared or old link: their own account, straight to the web episode.
      const series = await deps.findSeriesByCode(intent.code);
      if (!series) {
        await deps.send(to, { kind: "text", body: t("seriesNotFound") });
        return null;
      }
      const sc = await ctxFor(viewer, series, deps);
      const resume = await deps.resumeEpisode(viewer.id, series);
      const ep = Math.min(Math.max(intent.episode ?? resume, 1), Math.max(series.episodeCount, 1));
      const url = await deps.mintLink(viewer.id, series, ep);
      await deps.track(viewer.id, "chat_started", { seriesId: series.id, props: { code: series.code, source: "continue_link" } });
      await deps.send(to, {
        kind: "cta_url",
        body: sc.t("linkBody", { title: sc.lang === "en" ? series.titleEn : series.titleAr, n: ep }),
        buttonText: sc.t("btnOpenPlayer"),
        url,
      });
      await deps.track(viewer.id, "link_sent", { seriesId: series.id, episode: ep, props: { purpose: "continue" } });
      return { seriesId: series.id, step: "linked", waEpisode: Math.max(state.seriesId === series.id ? state.waEpisode : 0, series.waEpisodeCount) };
    }

    case "growth_picks": {
      // "See my picks" on the growth agent's template: the chat is open again, so send the series choice.
      const codes = (await deps.getGrowthPicks(viewer.id, intent.suggestionId)) ?? [];
      const picks: Series[] = [];
      for (const code of codes.slice(0, 3)) {
        const s = await deps.findSeriesByCode(code);
        if (s && !picks.some((p) => p.id === s.id)) picks.push(s);
      }
      if (!picks.length) {
        await sendMenu(c);
        return null;
      }
      await deps.track(viewer.id, "growth_picks_opened", { props: { suggestion: intent.suggestionId, picks: picks.map((p) => p.code) } });
      await deps.send(to, { kind: "buttons", body: t("picksBody"), buttons: picks.map((p) => ({ id: `${IDS.seriesPrefix}${p.code}`, title: titleOf(p, c.lang) })) });
      return null;
    }

    case "confirm_code": {
      const ok = await deps.confirmSpendCode(viewer.id, intent.code);
      if (ok) await deps.track(viewer.id, "device_confirmed");
      await deps.send(to, { kind: "text", body: ok ? t("confirmOk") : t("confirmFailed") });
      return null;
    }

    case "change_language": {
      await sendLanguageChoice(to, current, deps);
      return null;
    }

    case "support": {
      await deps.send(to, { kind: "text", body: t("supportBody") });
      return null;
    }

    case "delete_data": {
      // Logged for the team to action (see /data-deletion). Alerts stop immediately.
      await deps.track(viewer.id, "data_deletion_requested");
      await deps.setOptIn(viewer.id, "out", "delete_request");
      await deps.send(to, { kind: "text", body: t("deleteRequested") });
      return null;
    }

    case "menu":
    case "shared_reply":
    case "unknown": {
      if (!current && intent.type === "unknown") {
        await deps.send(to, { kind: "text", body: t("needSeriesFirst") });
      }
      await sendMenu(c);
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Visual-builder flows
// ---------------------------------------------------------------------------

const viewerLangToFlow = (l: ViewerLang | null): Lang | null => (l === "ar_en_subs" ? "en" : l === "ar" ? "ar" : null);

/** Connect the pure flow engine to WhatsApp and the database for one viewer. */
/** `run.chatEpisode` is updated as episodes are sent in the chat; save it with the run afterwards. */
export function flowEnvFor(
  viewer: Viewer,
  series: Series,
  deps: BotDeps,
  opts: { canSendFreeform: boolean; now?: () => number; run?: { chatEpisode: number } },
): FlowEnv {
  const v = { ...viewer };
  const run = opts.run ?? { chatEpisode: 0 };
  let web: SeriesProgress | null = null;
  const progress = async (): Promise<SeriesProgress> => {
    web ??= await deps.seriesProgress(v.id, series.id);
    return { maxStarted: web.maxStarted, maxCompleted: Math.max(web.maxCompleted, run.chatEpisode), lastWatchedAt: web.lastWatchedAt };
  };
  const clamp = (n: number) => Math.min(Math.max(n, 1), Math.max(series.episodeCount, 1));
  const env: FlowEnv = {
    lang: viewerLangToFlow(v.language) ?? "ar",
    title: (l) => titleOf(series, l),
    totalEpisodes: series.episodeCount,
    send: (msg, nodeId) => deps.send(v.waId, msg, { type: "flow", id: series.id, node: nodeId }),
    knownLanguage: () => viewerLangToFlow(v.language),
    setLanguage: async (l) => {
      v.language = l === "en" ? "ar_en_subs" : "ar";
      await deps.setViewerLanguage(v.id, v.language);
      await deps.track(v.id, "language_set", { props: { language: v.language } });
    },
    optIn: () => deps.getOptIn(v.id),
    setOptIn: async (yes) => {
      await deps.setOptIn(v.id, yes ? "in" : "out", "flow");
      await deps.track(v.id, "opt_in_changed", { props: { status: yes ? "in" : "out", source: "flow" } });
    },
    link: async (ep, resumeIfFurther) => {
      const p = await progress();
      // The next episode to watch: one they started but didn't finish, otherwise the one after the last finished.
      const further = p.maxStarted > p.maxCompleted ? p.maxStarted : p.maxCompleted > 0 ? p.maxCompleted + 1 : 0;
      const episode =
        ep === "resume" ? clamp(further || (await deps.resumeEpisode(v.id, series))) : resumeIfFurther ? clamp(Math.max(ep, further)) : clamp(ep);
      return { url: await deps.mintLink(v.id, series, episode), episode };
    },
    progress,
    noteChatEpisode: (n) => {
      run.chatEpisode = Math.max(run.chatEpisode, n);
    },
    clip: async (n, l) => {
      const clip = await deps.getClip(series.id, n);
      return { url: (l === "en" ? (clip?.videoUrlEn ?? clip?.videoUrlAr) : clip?.videoUrlAr) ?? null, title: (l === "en" ? clip?.titleEn : clip?.titleAr) ?? null };
    },
    mediaUrl: async (ref) => {
      if ("assetId" in ref) return ref.url;
      if (ref.source === "episode") {
        const clip = await deps.getClip(series.id, ref.episode);
        return (env.lang === "en" ? (clip?.videoUrlEn ?? clip?.videoUrlAr) : clip?.videoUrlAr) ?? null;
      }
      if (ref.source === "series") return artUrl({ poster: series.posterUrl, bannerWa: series.art?.bannerWa ?? null, bannerWide: series.art?.bannerWide ?? null, square: series.art?.square ?? null }, ref.slot);
      return ref.source === "poster" ? series.posterUrl : series.trailerUrl;
    },
    meta: (l) => metaVars(series.meta, l),
    template: (name, nodeId) => deps.sendFlowTemplate(v, series, name, nodeId),
    check: async (cond) => {
      if (cond.check === "started") {
        const p = await progress();
        return p.maxStarted > 0 || p.maxCompleted > 0;
      }
      if (cond.check === "watched_within") {
        const p = await progress();
        return p.lastWatchedAt !== null && (opts.now ?? Date.now)() - p.lastWatchedAt <= cond.hours * 3600_000;
      }
      return deps.checkCondition(v, series, cond);
    },
    suggest: async () => {
      await deps.track(v.id, "wa_dropout", { seriesId: series.id });
      const lang = viewerLangToFlow(v.language) ?? "ar";
      await sendSuggestions({ viewer: v, deps, lang, t: makeT(lang, await deps.getCopyOverrides(series.id, lang)) }, series);
    },
    seriesOptions: async (codes) => {
      const out: { code: string; titleAr: string; titleEn: string }[] = [];
      for (const code of codes.filter((c) => c !== "AUTO")) {
        const found = await deps.findSeriesByCode(code); // live series only
        if (found && found.id !== series.id) out.push({ code: found.code, titleAr: found.titleAr, titleEn: found.titleEn });
      }
      if (codes.includes("AUTO")) {
        const started = new Set((await deps.listFlowRuns(v.id)).map((r) => r.seriesId)); // chat or web
        for (const o of await deps.listOtherSeries(series.id)) {
          if (!started.has(o.id) && !out.some((x) => x.code === o.code)) out.push({ code: o.code, titleAr: o.titleAr, titleEn: o.titleEn });
        }
      }
      return out;
    },
    canSendFreeform: () => opts.canSendFreeform,
    track: (name, data) => deps.track(v.id, name as EventName, { seriesId: series.id, ...data }),
    now: opts.now ?? (() => Date.now()),
  };
  return env;
}

/** FlowEnv for the shared flow: works with or without a current series; buttons carry "s:" ids. */
export function sharedEnvFor(viewer: Viewer, series: Series | null, deps: BotDeps): FlowEnv {
  const v = { ...viewer };
  const base: FlowEnv = series
    ? flowEnvFor(v, series, deps, { canSendFreeform: true })
    : {
        lang: viewerLangToFlow(v.language) ?? "ar",
        title: () => "Watchat",
        totalEpisodes: 0,
        send: async () => {},
        knownLanguage: () => viewerLangToFlow(v.language),
        setLanguage: async (l) => {
          v.language = l === "en" ? "ar_en_subs" : "ar";
          await deps.setViewerLanguage(v.id, v.language);
          await deps.track(v.id, "language_set", { props: { language: v.language } });
        },
        optIn: () => deps.getOptIn(v.id),
        setOptIn: async () => {},
        // No series yet: the account page is the closest thing to "where they left off".
        link: async () => ({ url: await deps.mintAccountLink(v.id), episode: 1 }),
        progress: async () => ({ maxStarted: 0, maxCompleted: 0, lastWatchedAt: null }),
        noteChatEpisode: () => {},
        clip: async () => ({ url: null, title: null }),
        mediaUrl: (ref) => ("assetId" in ref ? ref.url : null),
        meta: () => ({ tagline: "", genre: "", cast: "" }),
        template: async () => "skipped",
        check: (c) => deps.checkCondition(v, null as unknown as Series, c),
        suggest: async () => {
          const lang = viewerLangToFlow(v.language) ?? "ar";
          await sendSuggestions({ viewer: v, deps, lang, t: makeT(lang, await deps.getCopyOverrides(null, lang)) }, null);
        },
        seriesOptions: async (codes) => {
          const out: { code: string; titleAr: string; titleEn: string }[] = [];
          for (const code of codes.filter((c) => c !== "AUTO")) {
            const found = await deps.findSeriesByCode(code);
            if (found) out.push({ code: found.code, titleAr: found.titleAr, titleEn: found.titleEn });
          }
          if (codes.includes("AUTO")) for (const o of await deps.listOtherSeries(null)) if (!out.some((x) => x.code === o.code)) out.push({ code: o.code, titleAr: o.titleAr, titleEn: o.titleEn });
          return out;
        },
        canSendFreeform: () => true,
        track: (name, data) => deps.track(v.id, name as EventName, data),
        now: () => Date.now(),
      };
  return {
    ...base,
    send: (msg) => deps.send(v.waId, msg),
    replyId: sharedReplyId,
    setOptIn: async (yes) => {
      await deps.setOptIn(v.id, yes ? "in" : "out", "shared_reply");
      await deps.track(v.id, "opt_in_changed", { props: { status: yes ? "in" : "out", source: "shared_reply" } });
    },
    check: async (c) => (c.check === "has_series" ? series !== null : base.check(c)),
    accountLink: () => deps.mintAccountLink(v.id),
    action: async (a: SharedAction) => {
      if (a === "delete_data") {
        await deps.track(v.id, "data_deletion_requested");
        await deps.setOptIn(v.id, "out", "delete_request");
        return;
      }
      await deps.setOptIn(v.id, a === "opt_in" ? "in" : "out", a === "opt_out" ? "stop_command" : "shared_reply");
      await deps.track(v.id, "opt_in_changed", { props: { status: a === "opt_in" ? "in" : "out", source: a === "opt_out" ? "stop_command" : "shared_reply" } });
    },
  };
}

export async function saveRunResult(
  deps: BotDeps,
  viewer: Viewer,
  seriesId: string,
  versionId: string,
  r: RunResult,
  meta: { entry: "chat" | "web"; chatEpisode: number; webTriggeredAt?: string | null },
): Promise<void> {
  if (r.status === "blocked") await deps.track(viewer.id, "flow_blocked", { seriesId, props: { node: r.nodeId, reason: r.reason } });
  await deps.saveFlowRun(viewer.id, {
    seriesId,
    versionId,
    nodeId: "nodeId" in r ? r.nodeId : "",
    status: r.status,
    resumeAt: r.status === "wait" ? new Date(r.resumeAt).toISOString() : null,
    ...meta,
  });
}

/** W7 — "not for me": list other live series. */
async function sendSuggestions({ viewer, deps, lang, t }: Ctx, current: Series | null) {
  const others = await deps.listOtherSeries(current?.id ?? null);
  if (others.length === 0) {
    await deps.send(viewer.waId, { kind: "text", body: t("noOtherSeries") });
    return;
  }
  await deps.send(viewer.waId, {
    kind: "list",
    body: t("notForMeBody"),
    buttonText: t("btnSeeSeries"),
    sections: [
      {
        title: t("seriesSectionTitle"),
        rows: others.map((s) => ({ id: `${IDS.seriesPrefix}${s.code}`, title: titleOf(s, lang) })),
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Message builders
// ---------------------------------------------------------------------------

/** W1 — bilingual welcome with language buttons (always shown in its Arabic-first default). */
async function sendLanguageChoice(to: string, series: Series | null, deps: BotDeps) {
  const t = makeT("ar", await deps.getCopyOverrides(series?.id ?? null, "ar"));
  await deps.send(to, {
    kind: "buttons",
    body: t("welcomeAskLanguage", { title: series ? `${series.titleAr} · ${series.titleEn}` : "Watchat" }),
    ...(series?.posterUrl ? { header: { type: "image" as const, link: series.posterUrl } } : {}),
    buttons: [
      { id: IDS.langAr, title: t("btnArabic") },
      { id: IDS.langEn, title: t("btnEnglishSubs") },
    ],
  });
}

/** W12 "Send me my link" — link to where the viewer left off. */
async function sendPlayerLink({ viewer, deps, lang, t }: Ctx, series: Series) {
  const ep = await deps.resumeEpisode(viewer.id, series);
  const url = await deps.mintLink(viewer.id, series, ep);
  await deps.send(viewer.waId, {
    kind: "cta_url",
    body: t("linkBody", { title: titleOf(series, lang), n: ep }),
    buttonText: t("btnOpenPlayer"),
    url,
  });
  await deps.track(viewer.id, "link_sent", { seriesId: series.id, episode: ep, props: { purpose: "menu" } });
}

/** "My account": a personal sign-in link that opens watchat.pro/me on this phone. */
async function sendAccountLink({ viewer, deps, t }: Ctx) {
  const url = await deps.mintAccountLink(viewer.id);
  await deps.send(viewer.waId, { kind: "cta_url", body: t("accountBody"), buttonText: t("btnMyAccount"), url });
  await deps.track(viewer.id, "link_sent", { props: { purpose: "account" } });
}

/** W6 — alerts opt-in. */
async function sendOptInAsk({ viewer, deps, t }: Ctx) {
  await deps.send(viewer.waId, {
    kind: "buttons",
    body: t("optInBody"),
    buttons: [
      { id: IDS.optInYes, title: t("btnYesNotify") },
      { id: IDS.optInNo, title: t("btnNoThanks") },
    ],
  });
}

/** W12 — menu list. */
async function sendMenu({ viewer, deps, t }: Ctx) {
  await deps.send(viewer.waId, {
    kind: "list",
    body: t("menuBody"),
    buttonText: t("btnMenu"),
    sections: [
      {
        title: t("menuSectionTitle"),
        rows: [
          { id: IDS.menuLink, title: t("menuLink") },
          { id: IDS.menuLang, title: t("menuLanguage") },
          { id: IDS.menuAlerts, title: t("menuAlerts") },
          { id: IDS.menuSupport, title: t("menuSupport") },
        ],
      },
    ],
  });
}
