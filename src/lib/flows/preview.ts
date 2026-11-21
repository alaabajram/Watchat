// In-memory FlowEnv for the editor's live chat preview (and tests). Nothing is sent or saved.

import type { OutMessage } from "../whatsapp/messages";
import { answer, resumeAfterWait, runFrom, startFlow, type FlowEnv, type RunResult } from "./engine";
import { artUrl, metaVars, type SeriesMeta } from "./meta";
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
  art?: { bannerWa: string | null; bannerWide: string | null; square: string | null };
  meta?: SeriesMeta;
  /** Other live series, for Series choice cards. */
  others?: { code: string; titleAr: string; titleEn: string }[];
};

/** A template as the preview shows it ({{1}} = series title, {{2}} = episode). */
export type PreviewTemplate = { approved: boolean; ar: { body: string; button: string | null } | null; en: { body: string; button: string | null } | null };
export type PreviewTemplates = Record<string, PreviewTemplate>;

/** reachedEpisode: furthest episode watched on the web. watchedRecently: watched on the web in the last hour. */
export type SampleViewer = { language: Lang | null; optIn: "in" | "out" | null; paid: boolean; reachedEpisode: number; withinWindow: boolean; watchedRecently?: boolean; hasSeries?: boolean };

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
    mediaUrl: (ref: MediaRef) => {
      if ("assetId" in ref) return ref.url;
      if (ref.source === "episode") return series.clips[ref.episode]?.[env.lang] ?? series.clips[ref.episode]?.ar ?? null;
      if (ref.source === "series") return artUrl({ poster: series.posterUrl, bannerWa: series.art?.bannerWa ?? null, bannerWide: series.art?.bannerWide ?? null, square: series.art?.square ?? null }, ref.slot);
      return ref.source === "poster" ? series.posterUrl : series.trailerUrl;
    },
    meta: (l) => metaVars(series.meta, l),
    template: async (name, nodeId, headerImage) => {
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
        msg: v.button
          ? { kind: "cta_url", body, buttonText: v.button, url: "https://watchat.pro/w/your-personal-link", ...(headerImage ? { header: { type: "image" as const, link: headerImage } } : {}) }
          : headerImage
            ? { kind: "image", link: headerImage, caption: body }
            : { kind: "text", body },
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
        case "came_back":
          return Boolean(state.watchedRecently);
        case "paid_since":
          return state.paid;
        case "has_series":
          return state.hasSeries ?? true;
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
    accountLink: async () => "https://watchat.pro/w/your-account-link",
    action: async (a) => {
      if (a === "opt_out" || a === "delete_data") state.optIn = "out";
      if (a === "opt_in") state.optIn = "in";
      const text = { opt_out: "⚙ Alerts turned off", opt_in: "⚙ Alerts turned on", delete_data: "⚙ Data deletion request logged for the team; alerts off" }[a];
      sink.items.push({ from: "system", text });
    },
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
  /** Shared replies: start at this “Viewer sends” card. */
  startAt?: string,
): Promise<PreviewSession> {
  const kw = startAt ? g.nodes.find((n) => n.id === startAt) : undefined;
  if (kw && kw.data.kind === "keyword") {
    const said = kw.data.words[0] ?? (kw.data.anythingElse ? "…" : "");
    const sink = { items: [{ from: "viewer", text: said } as PreviewItem] };
    const env = previewEnv(series, viewer, templates, sink);
    const result = await runFrom(g, kw.id, env);
    note(sink.items, result, g);
    return { items: [...sink.items], result, env, sink };
  }
  const trigger = g.nodes.find((n) => n.data.kind === "trigger");
  const first: PreviewItem =
    entry === "web"
      ? { from: "system", text: "🌐 Viewer starts watching on the web" }
      : trigger
        ? { from: "system", text: "⚡ The trigger moment arrives (sequence starts)" }
        : { from: "viewer", text: code };
  const sink = { items: [first] as PreviewItem[] };
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
