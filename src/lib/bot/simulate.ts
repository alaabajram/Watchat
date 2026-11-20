// Runs the real bot flow against an in-memory fake, to preview a scenario before it goes live.
// Nothing is sent to WhatsApp and nothing is written to the database.

import type { InboundMessage } from "../whatsapp/inbound";
import type { OutMessage } from "../whatsapp/messages";
import type { CopyLang, CopyOverrides } from "./copy";
import { EMPTY_STATE, handleInbound, type BotDeps, type ChatState, type Series, type ViewerLang } from "./flow";
import { IDS } from "./intents";

export type Turn = { from: "viewer"; text: string } | { from: "bot"; msg: OutMessage };

/** Follow the happy path: send the code, pick a language, Start, Next…, accept alerts. */
export async function simulateChat(series: Series, overrides: Record<CopyLang, CopyOverrides>, lang: CopyLang): Promise<Turn[]> {
  const turns: Turn[] = [];
  let state: ChatState = EMPTY_STATE;
  let language: ViewerLang | null = null;
  let optIn: "in" | "out" | null = null;
  const sample = "https://preview.invalid/";

  const deps: BotDeps = {
    upsertViewer: async (m) => ({ id: "preview", waId: m.from, language }),
    getChatState: async () => state,
    saveChatState: async (_id, s) => {
      state = s;
    },
    setViewerLanguage: async (_id, l) => {
      language = l;
    },
    findSeriesByCode: async (code) => (code === series.code ? series : null),
    getSeries: async (id) => (id === series.id ? series : null),
    getClip: async (_sid, n) => ({ number: n, titleAr: null, titleEn: null, videoUrlAr: `${sample}ep${n}.mp4`, videoUrlEn: `${sample}ep${n}.mp4` }),
    listOtherSeries: async () => [],
    getCopyOverrides: async (_sid, l) => overrides[l] ?? {},
    confirmSpendCode: async () => false,
    getOptIn: async () => optIn,
    setOptIn: async (_id, s) => {
      optIn = s;
    },
    resumeEpisode: async () => series.waEpisodeCount + 1,
    mintLink: async (_v, _s, ep) => `${sample}w/episode-${ep}`,
    send: async (_to, msg) => {
      turns.push({ from: "bot", msg });
    },
    track: async () => {},
    getPublishedFlow: async () => null,
    getFlowVersion: async () => null,
    getFlowRun: async () => null,
    saveFlowRun: async () => {},
    sendFlowTemplate: async () => "skipped",
    checkCondition: async () => false,
  };

  let seq = 0;
  const base = { from: "0", timestamp: 0 };
  const say = async (text: string) => {
    turns.push({ from: "viewer", text });
    await handleInbound({ ...base, id: `p${++seq}`, kind: "text", text } as InboundMessage, deps);
  };
  const tap = async (id: string, title: string) => {
    turns.push({ from: "viewer", text: `[${title}]` });
    await handleInbound({ ...base, id: `p${++seq}`, kind: "reply", replyId: id } as InboundMessage, deps);
  };

  await say(series.code);
  const prefer = [lang === "en" ? IDS.langEn : IDS.langAr, IDS.start, IDS.next, IDS.optInYes];
  for (let i = 0; i < 12; i++) {
    const last = [...turns].reverse().find((t): t is { from: "bot"; msg: OutMessage } => t.from === "bot");
    if (!last || last.msg.kind !== "buttons") break;
    const button = prefer.map((id) => (last.msg as Extract<OutMessage, { kind: "buttons" }>).buttons.find((b) => b.id === id)).find(Boolean);
    if (!button) break;
    await tap(button.id, button.title);
  }
  return turns;
}
