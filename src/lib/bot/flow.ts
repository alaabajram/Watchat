// The WhatsApp bot as a small state machine.
// Everything that touches the database or Meta goes through `BotDeps`, so the flow is easy to test
// (see flow.test.ts) and easy to re-host for a partner brand.
//
// Messages follow the screens doc: W1 welcome+language · W2 trailer · W3/W4 episodes · W5 cliffhanger link
// · W6 opt-in · W7 not for me · W12 menu · W14 alerts stopped.

import type { InboundMessage } from "../whatsapp/inbound";
import type { OutMessage } from "../whatsapp/messages";
import { copyFor, type CopyLang } from "./copy";
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
};

export type Clip = {
  number: number;
  titleAr: string | null;
  titleEn: string | null;
  videoUrlAr: string | null;
  videoUrlEn: string | null;
};

export type ChatStep = "idle" | "lang" | "trailer" | "episodes" | "linked";
export type ChatState = { seriesId: string | null; step: ChatStep; waEpisode: number };

export type EventName =
  | "chat_started"
  | "wa_episode_sent"
  | "wa_episode_done"
  | "wa_dropout"
  | "link_sent"
  | "opt_in_changed"
  | "language_set"
  | "data_deletion_requested";

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
  /** Web episode the viewer should land on (first unwatched, at least the one after the chat episodes). */
  resumeEpisode(viewerId: string, series: Series): Promise<number>;
  /** Create a personal signed link and return its full URL. */
  mintLink(viewerId: string, series: Series, episodeNumber: number): Promise<string>;
  send(to: string, msg: OutMessage): Promise<void>;
  track(
    viewerId: string,
    name: EventName,
    data?: { seriesId?: string; episode?: number; props?: Record<string, unknown> },
  ): Promise<void>;
}

export const EMPTY_STATE: ChatState = { seriesId: null, step: "idle", waEpisode: 0 };

const copyLang = (v: Viewer): CopyLang => (v.language === "ar_en_subs" ? "en" : "ar");
const titleOf = (s: Series, lang: CopyLang) => (lang === "en" ? s.titleEn : s.titleAr);

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
  const t = copyFor(copyLang(viewer));
  const to = viewer.waId;
  const current = state.seriesId ? await deps.getSeries(state.seriesId) : null;

  switch (intent.type) {
    case "series_code": {
      const series = await deps.findSeriesByCode(intent.code);
      if (!series) {
        await deps.send(to, { kind: "text", body: t.seriesNotFound });
        return null;
      }
      await deps.track(viewer.id, "chat_started", {
        seriesId: series.id,
        props: { code: series.code, source: msg.referral ? "ctwa_ad" : "organic", referral: msg.referral ?? null },
      });
      if (!viewer.language) {
        await sendLanguageChoice(to, series, deps);
        return { seriesId: series.id, step: "lang", waEpisode: 0 };
      }
      await sendTrailer(viewer, series, deps);
      return { seriesId: series.id, step: "trailer", waEpisode: 0 };
    }

    case "language": {
      await deps.setViewerLanguage(viewer.id, intent.lang);
      await deps.track(viewer.id, "language_set", { props: { language: intent.lang } });
      const updated: Viewer = { ...viewer, language: intent.lang };
      if (current && state.step === "lang") {
        await sendTrailer(updated, current, deps);
        return { ...state, step: "trailer" };
      }
      await sendMenu(updated, deps);
      return null;
    }

    case "next_episode": {
      if (!current) {
        await deps.send(to, { kind: "text", body: t.needSeriesFirst });
        return null;
      }
      if (state.waEpisode >= 1) {
        await deps.track(viewer.id, "wa_episode_done", { seriesId: current.id, episode: state.waEpisode });
      }
      if (state.waEpisode >= current.waEpisodeCount) {
        // Already past the chat episodes: just resend the link.
        await sendPlayerLink(viewer, current, deps);
        return null;
      }
      const n = state.waEpisode + 1;
      await sendEpisode(viewer, current, n, deps);
      if (n < current.waEpisodeCount) return { ...state, step: "episodes", waEpisode: n };

      // Last chat episode: cliffhanger link to the web (W5), then ask for alerts (W6) once.
      await sendCliffhangerLink(viewer, current, deps);
      if ((await deps.getOptIn(viewer.id)) === null) await sendOptInAsk(viewer, deps);
      return { ...state, step: "linked", waEpisode: n };
    }

    case "not_for_me": {
      await deps.track(viewer.id, "wa_dropout", { seriesId: current?.id, episode: state.waEpisode });
      const others = await deps.listOtherSeries(current?.id ?? null);
      if (others.length === 0) {
        await deps.send(to, { kind: "text", body: t.noOtherSeries });
        return null;
      }
      const lang = copyLang(viewer);
      await deps.send(to, {
        kind: "list",
        body: t.notForMeBody,
        buttonText: t.btnSeeSeries,
        sections: [
          {
            title: t.seriesSectionTitle,
            rows: others.map((s) => ({ id: `${IDS.seriesPrefix}${s.code}`, title: titleOf(s, lang) })),
          },
        ],
      });
      return null;
    }

    case "opt_in": {
      await deps.setOptIn(viewer.id, intent.yes ? "in" : "out", "button");
      await deps.track(viewer.id, "opt_in_changed", { props: { status: intent.yes ? "in" : "out", source: "button" } });
      await deps.send(to, { kind: "text", body: intent.yes ? t.optInConfirmed : t.optInDeclined });
      return null;
    }

    case "stop": {
      await deps.setOptIn(viewer.id, "out", "stop_command");
      await deps.track(viewer.id, "opt_in_changed", { props: { status: "out", source: "stop_command" } });
      await deps.send(to, {
        kind: "buttons",
        body: t.stopConfirmed,
        buttons: [{ id: IDS.optInYes, title: t.btnAlertsOn }],
      });
      return null;
    }

    case "toggle_alerts": {
      const status = await deps.getOptIn(viewer.id);
      if (status === "in") {
        await deps.setOptIn(viewer.id, "out", "menu");
        await deps.track(viewer.id, "opt_in_changed", { props: { status: "out", source: "menu" } });
        await deps.send(to, { kind: "buttons", body: t.stopConfirmed, buttons: [{ id: IDS.optInYes, title: t.btnAlertsOn }] });
      } else {
        await sendOptInAsk(viewer, deps);
      }
      return null;
    }

    case "link": {
      if (!current) {
        await deps.send(to, { kind: "text", body: t.needSeriesFirst });
        return null;
      }
      await sendPlayerLink(viewer, current, deps);
      return null;
    }

    case "change_language": {
      await sendLanguageChoice(to, current, deps);
      return null;
    }

    case "support": {
      await deps.send(to, { kind: "text", body: t.supportBody });
      return null;
    }

    case "delete_data": {
      // Logged for the team to action manually (see /data-deletion). Automate before launch.
      await deps.track(viewer.id, "data_deletion_requested");
      await deps.setOptIn(viewer.id, "out", "delete_request");
      await deps.send(to, { kind: "text", body: t.deleteRequested });
      return null;
    }

    case "menu":
    case "unknown": {
      if (!current && intent.type === "unknown") {
        await deps.send(to, { kind: "text", body: t.needSeriesFirst });
      }
      await sendMenu(viewer, deps);
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Message builders
// ---------------------------------------------------------------------------

/** W1 — bilingual welcome with language buttons. */
async function sendLanguageChoice(to: string, series: Series | null, deps: BotDeps) {
  const t = copyFor("ar");
  await deps.send(to, {
    kind: "buttons",
    body: t.welcomeAskLanguage(series ? `${series.titleAr} · ${series.titleEn}` : "Watchat"),
    ...(series?.posterUrl ? { header: { type: "image" as const, link: series.posterUrl } } : {}),
    buttons: [
      { id: IDS.langAr, title: t.btnArabic },
      { id: IDS.langEn, title: t.btnEnglishSubs },
    ],
  });
}

/** W2 — trailer with Start / Not for me. */
async function sendTrailer(viewer: Viewer, series: Series, deps: BotDeps) {
  const lang = copyLang(viewer);
  const t = copyFor(lang);
  await deps.send(viewer.waId, {
    kind: "buttons",
    body: t.trailerBody(titleOf(series, lang)),
    ...(series.trailerUrl ? { header: { type: "video" as const, link: series.trailerUrl } } : {}),
    buttons: [
      { id: IDS.start, title: t.btnStartEp1 },
      { id: IDS.notForMe, title: t.btnNotForMe },
    ],
  });
}

/** W3 / W4 — one chat episode. Episodes before the last get Next / Not for me buttons. */
async function sendEpisode(viewer: Viewer, series: Series, n: number, deps: BotDeps) {
  const lang = copyLang(viewer);
  const t = copyFor(lang);
  const clip = await deps.getClip(series.id, n);
  const videoUrl = lang === "en" ? (clip?.videoUrlEn ?? clip?.videoUrlAr) : clip?.videoUrlAr;
  const epTitle = (lang === "en" ? clip?.titleEn : clip?.titleAr) ?? titleOf(series, lang);
  const caption = t.episodeCaption(n, series.episodeCount, epTitle);
  const isLast = n >= series.waEpisodeCount;

  if (isLast) {
    await deps.send(
      viewer.waId,
      videoUrl ? { kind: "video", link: videoUrl, caption } : { kind: "text", body: `${caption}\n${t.videoMissing(n)}` },
    );
  } else {
    await deps.send(viewer.waId, {
      kind: "buttons",
      body: videoUrl ? caption : `${caption}\n${t.videoMissing(n)}`,
      ...(videoUrl ? { header: { type: "video" as const, link: videoUrl } } : {}),
      buttons: [
        { id: IDS.next, title: t.btnNext },
        { id: IDS.notForMe, title: t.btnNotForMe },
      ],
    });
  }
  await deps.track(viewer.id, "wa_episode_sent", { seriesId: series.id, episode: n });
}

/** W5 — personal link to the first web episode. */
async function sendCliffhangerLink(viewer: Viewer, series: Series, deps: BotDeps) {
  const t = copyFor(copyLang(viewer));
  const nextEp = series.waEpisodeCount + 1;
  const url = await deps.mintLink(viewer.id, series, nextEp);
  await deps.send(viewer.waId, {
    kind: "cta_url",
    body: t.cliffhangerBody(nextEp),
    buttonText: t.btnWatchEp(nextEp),
    url,
    ...(series.posterUrl ? { header: { type: "image" as const, link: series.posterUrl } } : {}),
  });
  await deps.track(viewer.id, "link_sent", { seriesId: series.id, episode: nextEp, props: { purpose: "cliffhanger" } });
}

/** W12 "Send me my link" — link to where the viewer left off. */
async function sendPlayerLink(viewer: Viewer, series: Series, deps: BotDeps) {
  const lang = copyLang(viewer);
  const t = copyFor(lang);
  const ep = await deps.resumeEpisode(viewer.id, series);
  const url = await deps.mintLink(viewer.id, series, ep);
  await deps.send(viewer.waId, {
    kind: "cta_url",
    body: t.linkBody(titleOf(series, lang), ep),
    buttonText: t.btnOpenPlayer,
    url,
  });
  await deps.track(viewer.id, "link_sent", { seriesId: series.id, episode: ep, props: { purpose: "menu" } });
}

/** W6 — alerts opt-in. */
async function sendOptInAsk(viewer: Viewer, deps: BotDeps) {
  const t = copyFor(copyLang(viewer));
  await deps.send(viewer.waId, {
    kind: "buttons",
    body: t.optInBody,
    buttons: [
      { id: IDS.optInYes, title: t.btnYesNotify },
      { id: IDS.optInNo, title: t.btnNoThanks },
    ],
  });
}

/** W12 — menu list. */
async function sendMenu(viewer: Viewer, deps: BotDeps) {
  const t = copyFor(copyLang(viewer));
  await deps.send(viewer.waId, {
    kind: "list",
    body: t.menuBody,
    buttonText: t.btnMenu,
    sections: [
      {
        title: t.menuSectionTitle,
        rows: [
          { id: IDS.menuLink, title: t.menuLink },
          { id: IDS.menuLang, title: t.menuLanguage },
          { id: IDS.menuAlerts, title: t.menuAlerts },
          { id: IDS.menuSupport, title: t.menuSupport },
        ],
      },
    ],
  });
}
