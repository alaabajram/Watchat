// The WhatsApp bot as a small state machine.
// Everything that touches the database or Meta goes through `BotDeps`, so the flow is easy to test
// (see flow.test.ts) and easy to re-host for a partner brand.
//
// A series code starts the series' flow (Flow builder; the standard flow is published automatically
// when none exists) and button taps move through it. Everything else here is shared replies:
// menu, language, alerts, links, support, device confirmation, data deletion (texts: Shared replies).

import { answer, startFlow, type FlowEnv, type RunResult, type SeriesProgress } from "../flows/engine";
import type { Condition, FlowGraph, Lang } from "../flows/types";
import type { InboundMessage } from "../whatsapp/inbound";
import type { OutMessage } from "../whatsapp/messages";
import { makeT, type CopyLang, type CopyOverrides, type T } from "./copy";
import { IDS, parseIntent, type Intent } from "./intents";

export type ViewerLang = "ar" | "ar_en_subs";

export type Viewer = { id: string; waId: string; language: ViewerLang | null };

export type Series = {
  id: string;
  code: string;
  titleAr: string;
  titleEn: string;
  posterUrl: string | null;
  trailerUrl: string | null;
  episodeCount: number;
  waEpisodeCount: number; // episodes the standard flow sends inside the chat (default 3)
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
  | "flow_blocked";

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
  send(to: string, msg: OutMessage): Promise<void>;
  /** The series' live flow; the standard flow is published automatically if none exists. Null only if the series is gone. */
  getPublishedFlow(seriesId: string): Promise<{ versionId: string; graph: FlowGraph } | null>;
  getFlowVersion(versionId: string): Promise<FlowGraph | null>;
  getFlowRun(viewerId: string, seriesId: string): Promise<FlowRun | null>;
  /** The viewer's runs, most recently active first. */
  listFlowRuns(viewerId: string): Promise<FlowRun[]>;
  saveFlowRun(viewerId: string, run: FlowRun): Promise<void>;
  /** The viewer moved to another series: hold that series' waiting follow-ups. */
  pauseOtherRuns(viewerId: string, activeSeriesId: string): Promise<void>;
  /** What the viewer watched of a series on the web. */
  seriesProgress(viewerId: string, seriesId: string): Promise<SeriesProgress>;
  /** Send an approved template (respects opt-in and the marketing frequency cap). */
  sendFlowTemplate(viewer: Viewer, series: Series, name: string): Promise<"sent" | "skipped" | "failed">;
  checkCondition(viewer: Viewer, series: Series, condition: Condition): Promise<boolean>;
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
export async function handleInbound(msg: InboundMessage, deps: BotDeps): Promise<void> {
  const viewer = await deps.upsertViewer(msg);
  const state = await deps.getChatState(viewer.id);
  const intent = parseIntent(msg);
  const next = await route(intent, viewer, state, msg, deps);
  if (next) await deps.saveChatState(viewer.id, next);
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
        await deps.send(to, { kind: "text", body: t("needSeriesFirst") });
        return null;
      }
      await sendPlayerLink(c, current);
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
    send: (msg) => deps.send(v.waId, msg),
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
    mediaUrl: (ref) => ("assetId" in ref ? ref.url : ref.source === "poster" ? series.posterUrl : series.trailerUrl),
    template: (name) => deps.sendFlowTemplate(v, series, name),
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
    canSendFreeform: () => opts.canSendFreeform,
    track: (name, data) => deps.track(v.id, name as EventName, { seriesId: series.id, ...data }),
    now: opts.now ?? (() => Date.now()),
  };
  return env;
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
