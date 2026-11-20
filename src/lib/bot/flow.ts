// The WhatsApp bot as a small state machine.
// Everything that touches the database or Meta goes through `BotDeps`, so the flow is easy to test
// (see flow.test.ts) and easy to re-host for a partner brand.
//
// Messages follow the screens doc: W1 welcome+language · W2 trailer · W3/W4 episodes · W5 cliffhanger link
// · W6 opt-in · W7 not for me · W12 menu · W13 device confirmed · W14 alerts stopped.
// Texts come from copy.ts with admin overrides; the scenario switches come from the series row.

import { answer, startFlow, type FlowEnv, type RunResult } from "../flows/engine";
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
  waEpisodeCount: number; // episodes sent inside the chat (default 3)
  askLanguage: boolean; // scenario: ask Arabic / English subtitles first
  sendTrailer: boolean; // scenario: send the trailer before episode 1
  askOptIn: boolean; // scenario: ask for new-episode alerts after the link
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

/** Where a viewer is in a series' published flow. */
export type FlowRun = {
  seriesId: string;
  versionId: string;
  nodeId: string;
  status: "input" | "wait" | "running" | "done" | "blocked";
  resumeAt: string | null;
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
  /** The series' published flow (visual builder), or null to use the built-in scenario. */
  getPublishedFlow(seriesId: string): Promise<{ versionId: string; graph: FlowGraph } | null>;
  getFlowVersion(versionId: string): Promise<FlowGraph | null>;
  getFlowRun(viewerId: string): Promise<FlowRun | null>;
  saveFlowRun(viewerId: string, run: FlowRun): Promise<void>;
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
      if (flow) {
        await deps.track(viewer.id, "flow_started", { seriesId: series.id, props: { version: flow.versionId } });
        const result = await startFlow(flow.graph, flowEnvFor(viewer, series, deps, { canSendFreeform: true }));
        await saveRunResult(deps, viewer, series.id, flow.versionId, result);
        return { seriesId: series.id, step: "flow", waEpisode: 0 };
      }
      if (!viewer.language && series.askLanguage) {
        await sendLanguageChoice(to, series, deps);
        return { seriesId: series.id, step: "lang", waEpisode: 0 };
      }
      const sc = await ctxFor(viewer, series, deps);
      return startSeries(sc, series);
    }

    case "language": {
      await deps.setViewerLanguage(viewer.id, intent.lang);
      await deps.track(viewer.id, "language_set", { props: { language: intent.lang } });
      const updated = await ctxFor({ ...viewer, language: intent.lang }, current, deps);
      if (current && state.step === "lang") return startSeries(updated, current);
      await sendMenu(updated);
      return null;
    }

    case "next_episode": {
      if (!current) {
        await deps.send(to, { kind: "text", body: t("needSeriesFirst") });
        return null;
      }
      if (state.waEpisode >= 1) {
        await deps.track(viewer.id, "wa_episode_done", { seriesId: current.id, episode: state.waEpisode });
      }
      if (state.waEpisode >= current.waEpisodeCount) {
        await sendPlayerLink(c, current); // already past the chat episodes
        return null;
      }
      return sendNextChatEpisode(c, current, state.waEpisode + 1);
    }

    case "not_for_me": {
      await deps.track(viewer.id, "wa_dropout", { seriesId: current?.id, episode: state.waEpisode });
      await sendSuggestions(c, current);
      return null;
    }

    case "flow_reply": {
      const run = await deps.getFlowRun(viewer.id);
      const graph = run ? await deps.getFlowVersion(run.versionId) : null;
      const series = run ? await deps.getSeries(run.seriesId) : null;
      if (!run || !graph || !series) {
        await sendMenu(c);
        return null;
      }
      const result = await answer(graph, intent.nodeId, intent.port, flowEnvFor(viewer, series, deps, { canSendFreeform: true }));
      await saveRunResult(deps, viewer, series.id, run.versionId, result);
      return null;
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

/** After the code (and language): trailer if the scenario wants one, otherwise straight to episode 1. */
async function startSeries(c: Ctx, series: Series): Promise<ChatState> {
  if (series.sendTrailer) {
    await sendTrailer(c, series);
    return { seriesId: series.id, step: "trailer", waEpisode: 0 };
  }
  return sendNextChatEpisode(c, series, 1);
}

/** Send chat episode n; after the last chat episode, the cliffhanger link and (optionally) the alerts question. */
async function sendNextChatEpisode(c: Ctx, series: Series, n: number): Promise<ChatState> {
  if (series.waEpisodeCount <= 0) {
    await sendCliffhangerLink(c, series, 1);
    return { seriesId: series.id, step: "linked", waEpisode: 0 };
  }
  await sendEpisode(c, series, n);
  if (n < series.waEpisodeCount) return { seriesId: series.id, step: "episodes", waEpisode: n };

  await sendCliffhangerLink(c, series, series.waEpisodeCount + 1);
  if (series.askOptIn && (await c.deps.getOptIn(c.viewer.id)) === null) await sendOptInAsk(c);
  return { seriesId: series.id, step: "linked", waEpisode: n };
}

// ---------------------------------------------------------------------------
// Visual-builder flows
// ---------------------------------------------------------------------------

const viewerLangToFlow = (l: ViewerLang | null): Lang | null => (l === "ar_en_subs" ? "en" : l === "ar" ? "ar" : null);

/** Connect the pure flow engine to WhatsApp and the database for one viewer. */
export function flowEnvFor(viewer: Viewer, series: Series, deps: BotDeps, opts: { canSendFreeform: boolean; now?: () => number }): FlowEnv {
  const v = { ...viewer };
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
    link: async (ep) => {
      const episode = ep === "resume" ? await deps.resumeEpisode(v.id, series) : Math.min(Math.max(ep, 1), Math.max(series.episodeCount, 1));
      return { url: await deps.mintLink(v.id, series, episode), episode };
    },
    clip: async (n, l) => {
      const clip = await deps.getClip(series.id, n);
      return { url: (l === "en" ? (clip?.videoUrlEn ?? clip?.videoUrlAr) : clip?.videoUrlAr) ?? null, title: (l === "en" ? clip?.titleEn : clip?.titleAr) ?? null };
    },
    mediaUrl: (ref) => ("assetId" in ref ? ref.url : ref.source === "poster" ? series.posterUrl : series.trailerUrl),
    template: (name) => deps.sendFlowTemplate(v, series, name),
    check: (cond) => deps.checkCondition(v, series, cond),
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

export async function saveRunResult(deps: BotDeps, viewer: Viewer, seriesId: string, versionId: string, r: RunResult): Promise<void> {
  if (r.status === "blocked") await deps.track(viewer.id, "flow_blocked", { seriesId, props: { node: r.nodeId, reason: r.reason } });
  await deps.saveFlowRun(viewer.id, {
    seriesId,
    versionId,
    nodeId: "nodeId" in r ? r.nodeId : "",
    status: r.status,
    resumeAt: r.status === "wait" ? new Date(r.resumeAt).toISOString() : null,
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

/** W2 — trailer with Start / Not for me. */
async function sendTrailer({ viewer, deps, lang, t }: Ctx, series: Series) {
  await deps.send(viewer.waId, {
    kind: "buttons",
    body: t("trailerBody", { title: titleOf(series, lang) }),
    ...(series.trailerUrl ? { header: { type: "video" as const, link: series.trailerUrl } } : {}),
    buttons: [
      { id: IDS.start, title: t("btnStartEp1") },
      { id: IDS.notForMe, title: t("btnNotForMe") },
    ],
  });
}

/** W3 / W4 — one chat episode. Episodes before the last get Next / Not for me buttons. */
async function sendEpisode({ viewer, deps, lang, t }: Ctx, series: Series, n: number) {
  const clip = await deps.getClip(series.id, n);
  const videoUrl = lang === "en" ? (clip?.videoUrlEn ?? clip?.videoUrlAr) : clip?.videoUrlAr;
  const epTitle = (lang === "en" ? clip?.titleEn : clip?.titleAr) ?? titleOf(series, lang);
  const caption = t("episodeCaption", { n, total: series.episodeCount, title: epTitle });
  const missing = t("videoMissing", { n });

  if (n >= series.waEpisodeCount) {
    await deps.send(
      viewer.waId,
      videoUrl ? { kind: "video", link: videoUrl, caption } : { kind: "text", body: `${caption}\n${missing}` },
    );
  } else {
    await deps.send(viewer.waId, {
      kind: "buttons",
      body: videoUrl ? caption : `${caption}\n${missing}`,
      ...(videoUrl ? { header: { type: "video" as const, link: videoUrl } } : {}),
      buttons: [
        { id: IDS.next, title: t("btnNext") },
        { id: IDS.notForMe, title: t("btnNotForMe") },
      ],
    });
  }
  await deps.track(viewer.id, "wa_episode_sent", { seriesId: series.id, episode: n });
}

/** W5 — personal link to the first web episode. */
async function sendCliffhangerLink({ viewer, deps, t }: Ctx, series: Series, nextEp: number) {
  const url = await deps.mintLink(viewer.id, series, nextEp);
  await deps.send(viewer.waId, {
    kind: "cta_url",
    body: t("cliffhangerBody", { next: nextEp }),
    buttonText: t("btnWatchEp", { next: nextEp }),
    url,
    ...(series.posterUrl ? { header: { type: "image" as const, link: series.posterUrl } } : {}),
  });
  await deps.track(viewer.id, "link_sent", { seriesId: series.id, episode: nextEp, props: { purpose: "cliffhanger" } });
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
