// In-memory FlowEnv for the editor's live chat preview (and tests). Nothing is sent or saved.

import type { OutMessage } from "../whatsapp/messages";
import { answer, resumeAfterWait, startFlow, type FlowEnv, type RunResult } from "./engine";
import type { Condition, FlowGraph, Lang, MediaRef } from "./types";

export type PreviewItem =
  | { from: "viewer"; text: string }
  | { from: "bot"; msg: OutMessage; nodeId: string }
  | { from: "system"; text: string; nodeId?: string };

export type PreviewSeries = {
  titleAr: string;
  titleEn: string;
  episodeCount: number;
  posterUrl: string | null;
  trailerUrl: string | null;
  clips: Record<number, { ar: string | null; en: string | null }>;
  /** Other live series, for Series choice cards. */
  others?: { code: string; titleAr: string; titleEn: string }[];
};

/** A template as the preview shows it ({{1}} = series title, {{2}} = episode). */
export type PreviewTemplate = { approved: boolean; ar: { body: string; button: string | null } | null; en: { body: string; button: string | null } | null };
export type PreviewTemplates = Record<string, PreviewTemplate>;

/** reachedEpisode: furthest episode watched on the web. watchedRecently: watched on the web in the last hour. */
export type SampleViewer = { language: Lang | null; optIn: "in" | "out" | null; paid: boolean; reachedEpisode: number; withinWindow: boolean; watchedRecently?: boolean };

/** `items` is a fresh array after every step (handy for React state); the env writes to `sink`. */
export type PreviewSession = {
  items: PreviewItem[];
  result: RunResult;
  env: FlowEnv;
  sink: { items: PreviewItem[] };
};

export function previewEnv(series: PreviewSeries, viewer: SampleViewer, templates: PreviewTemplates, sink: { items: PreviewItem[] }): FlowEnv {
  let clock = Date.parse("2026-01-01T10:00:00Z");
  let chatEpisode = 0;
  const state = { ...viewer };
  const env: FlowEnv = {
    lang: state.language ?? "ar",
    title: (l) => (l === "en" ? series.titleEn : series.titleAr),
    totalEpisodes: series.episodeCount,
    send: async (msg, nodeId) => {
      sink.items.push({ from: "bot", msg, nodeId });
    },
    knownLanguage: () => state.language,
    setLanguage: async (l) => {
      state.language = l;
    },
    optIn: async () => state.optIn,
    setOptIn: async (yes) => {
      state.optIn = yes ? "in" : "out";
    },
    link: async (ep, resumeIfFurther) => {
      const resume = Math.min(Math.max(state.reachedEpisode + 1, 1), Math.max(series.episodeCount, 1));
      const episode = ep === "resume" ? resume : resumeIfFurther ? Math.max(ep, resume) : ep;
      return { url: `https://watchat.pro/w/your-personal-link`, episode };
    },
    progress: async () => ({
      maxStarted: state.reachedEpisode,
      maxCompleted: Math.max(state.reachedEpisode, chatEpisode),
      lastWatchedAt: state.watchedRecently ? clock - 3600_000 : state.reachedEpisode > 0 ? clock - 3 * 86400_000 : null,
    }),
    noteChatEpisode: (n) => {
      chatEpisode = Math.max(chatEpisode, n);
    },
    clip: async (n, l) => ({ url: series.clips[n]?.[l] ?? series.clips[n]?.ar ?? null, title: null }),
    mediaUrl: (ref: MediaRef) => ("assetId" in ref ? ref.url : ref.source === "poster" ? series.posterUrl : series.trailerUrl),
    template: async (name, nodeId) => {
      const t = templates[name];
      const lang = env.lang;
      const v = t ? (t[lang] ?? t.ar ?? t.en) : null;
      if (!t || !v) {
        sink.items.push({ from: "system", text: name ? `Template “${name}” doesn't exist yet.` : "Template card: no template picked.", nodeId });
        return "skipped";
      }
      if (!t.approved) sink.items.push({ from: "system", text: `Template “${name}” · waiting for Meta approval (skipped until approved)`, nodeId });
      const body = v.body.replace(/\{\{1\}\}/g, env.title(lang)).replace(/\{\{2\}\}/g, String(Math.max(state.reachedEpisode, 1)));
      sink.items.push({
        from: "bot",
        nodeId,
        msg: v.button ? { kind: "cta_url", body, buttonText: v.button, url: "https://watchat.pro/w/your-personal-link" } : { kind: "text", body },
      });
      return t.approved ? "sent" : "skipped";
    },
    check: async (c: Condition) => {
      switch (c.check) {
        case "opted_in":
          return state.optIn === "in";
        case "language_en":
          return state.language === "en";
        case "paid":
          return state.paid;
        case "reached_episode":
          return state.reachedEpisode >= c.episode;
        case "started":
          return state.reachedEpisode > 0 || chatEpisode > 0;
        case "watched_within":
          return Boolean(state.watchedRecently) && c.hours >= 1;
      }
    },
    suggest: async () => {
      sink.items.push({ from: "system", text: "Bot sends the list of other series." });
    },
    seriesOptions: async (codes) => {
      const others = series.others ?? [];
      const fixed = others.filter((o) => codes.includes(o.code));
      return codes.includes("AUTO") ? [...fixed, ...others.filter((o) => !codes.includes(o.code))] : fixed;
    },
    canSendFreeform: () => state.withinWindow,
    track: async () => {},
    now: () => clock,
  };
  // Waits are skipped in the preview; move the clock so resumeAt stays meaningful.
  (env as FlowEnv & { advance: (ms: number) => void }).advance = (ms) => {
    clock += ms;
  };
  return env;
}

function note(items: PreviewItem[], r: RunResult, g: FlowGraph) {
  if (r.status === "wait") {
    const n = g.nodes.find((x) => x.id === r.nodeId);
    const minutes = n?.data.kind === "wait" ? n.data.minutes : 0;
    items.push({ from: "system", text: `⏱ Waits ${formatMinutes(minutes)}`, nodeId: r.nodeId });
  }
  if (r.status === "blocked") items.push({ from: "system", text: `⛔ ${r.reason}`, nodeId: r.nodeId });
  if (r.status === "done") items.push({ from: "system", text: "Chat ends here." });
}

export function formatMinutes(m: number): string {
  if (m % 1440 === 0) return `${m / 1440} day${m === 1440 ? "" : "s"}`;
  if (m % 60 === 0) return `${m / 60} hour${m === 60 ? "" : "s"}`;
  return `${m} minute${m === 1 ? "" : "s"}`;
}

export async function previewStart(
  g: FlowGraph,
  series: PreviewSeries,
  viewer: SampleViewer,
  templates: PreviewTemplates,
  code: string,
  entry: "chat" | "web" = "chat",
): Promise<PreviewSession> {
  const sink = { items: [entry === "web" ? { from: "system", text: "🌐 Viewer starts watching on the web" } : { from: "viewer", text: code }] as PreviewItem[] };
  const env = previewEnv(series, viewer, templates, sink);
  const result = await startFlow(g, env, entry);
  note(sink.items, result, g);
  return { items: [...sink.items], result, env, sink };
}

export async function previewTap(g: FlowGraph, s: PreviewSession, nodeId: string, port: string, label: string): Promise<PreviewSession> {
  s.sink.items.push({ from: "viewer", text: label });
  const result = await answer(g, nodeId, port, s.env);
  note(s.sink.items, result, g);
  return { ...s, items: [...s.sink.items], result };
}

export async function previewSkipWait(g: FlowGraph, s: PreviewSession): Promise<PreviewSession> {
  if (s.result.status !== "wait") return s;
  (s.env as FlowEnv & { advance: (ms: number) => void }).advance(s.result.resumeAt - s.env.now());
  const result = await resumeAfterWait(g, s.result.nodeId, s.env);
  note(s.sink.items, result, g);
  return { ...s, items: [...s.sink.items], result };
}
