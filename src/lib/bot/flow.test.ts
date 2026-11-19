import { describe, expect, it } from "vitest";
import type { InboundMessage } from "../whatsapp/inbound";
import type { OutMessage } from "../whatsapp/messages";
import { EMPTY_STATE, handleInbound, type BotDeps, type ChatState, type Series, type ViewerLang } from "./flow";
import { IDS } from "./intents";

const SERIES: Series = {
  id: "s1",
  code: "SECRETS01",
  titleAr: "أسرار البيت",
  titleEn: "Secrets of the House",
  posterUrl: "https://cdn.example/poster.jpg",
  trailerUrl: "https://cdn.example/trailer.mp4",
  episodeCount: 30,
  waEpisodeCount: 3,
};
const OTHER: Series = { ...SERIES, id: "s2", code: "DESERT02", titleAr: "رمال", titleEn: "Sands" };

/** In-memory fake of the database + Meta, recording everything the bot sends. */
function fakeDeps() {
  const sent: OutMessage[] = [];
  const events: string[] = [];
  let state: ChatState = EMPTY_STATE;
  let language: ViewerLang | null = null;
  let optIn: "in" | "out" | null = null;

  const deps: BotDeps = {
    upsertViewer: async (m) => ({ id: "v1", waId: m.from, language }),
    getChatState: async () => state,
    saveChatState: async (_id, s) => {
      state = s;
    },
    setViewerLanguage: async (_id, l) => {
      language = l;
    },
    findSeriesByCode: async (code) => [SERIES, OTHER].find((s) => s.code === code) ?? null,
    getSeries: async (id) => [SERIES, OTHER].find((s) => s.id === id) ?? null,
    getClip: async (_sid, n) => ({
      number: n,
      titleAr: null,
      titleEn: null,
      videoUrlAr: `https://cdn.example/ep${n}-ar.mp4`,
      videoUrlEn: `https://cdn.example/ep${n}-en.mp4`,
    }),
    listOtherSeries: async (exclude) => [SERIES, OTHER].filter((s) => s.id !== exclude),
    getOptIn: async () => optIn,
    setOptIn: async (_id, s) => {
      optIn = s;
    },
    resumeEpisode: async () => 4,
    mintLink: async (_v, _s, ep) => `https://watchat.test/w/token-ep${ep}`,
    send: async (_to, msg) => {
      sent.push(msg);
    },
    track: async (_v, name) => {
      events.push(name);
    },
  };
  return { deps, sent, events, getState: () => state, getOptIn: () => optIn, getLanguage: () => language };
}

let seq = 0;
const text = (body: string, referral = false): InboundMessage => ({
  id: `m${++seq}`,
  from: "971500000000",
  timestamp: 0,
  kind: "text",
  text: body,
  ...(referral ? { referral: { sourceType: "ad", sourceId: "ad123" } } : {}),
});
const tap = (replyId: string): InboundMessage => ({ id: `m${++seq}`, from: "971500000000", timestamp: 0, kind: "reply", replyId });

describe("bot flow: series code to cliffhanger link", () => {
  it("walks W1 → W2 → episodes 1–3 → W5 link → W6 opt-in", async () => {
    const f = fakeDeps();

    // W1: series code from a Click-to-WhatsApp ad → language choice
    await handleInbound(text("Hi! I want to watch SECRETS01", true), f.deps);
    expect(f.sent.at(-1)).toMatchObject({ kind: "buttons", buttons: [{ id: IDS.langAr }, { id: IDS.langEn }] });
    expect(f.getState()).toEqual({ seriesId: "s1", step: "lang", waEpisode: 0 });
    expect(f.events).toContain("chat_started");

    // W2: Arabic chosen → trailer with Start / Not for me
    await handleInbound(tap(IDS.langAr), f.deps);
    expect(f.getLanguage()).toBe("ar");
    expect(f.sent.at(-1)).toMatchObject({
      kind: "buttons",
      header: { type: "video", link: SERIES.trailerUrl },
      buttons: [{ id: IDS.start }, { id: IDS.notForMe }],
    });

    // Episode 1 and 2 arrive with Next buttons
    await handleInbound(tap(IDS.start), f.deps);
    expect(f.sent.at(-1)).toMatchObject({ kind: "buttons", header: { link: "https://cdn.example/ep1-ar.mp4" } });
    await handleInbound(tap(IDS.next), f.deps);
    expect(f.sent.at(-1)).toMatchObject({ kind: "buttons", header: { link: "https://cdn.example/ep2-ar.mp4" } });
    expect(f.events.filter((e) => e === "wa_episode_done")).toHaveLength(1);

    // Episode 3 → plain video, then the personal link to episode 4, then the opt-in question
    const before = f.sent.length;
    await handleInbound(tap(IDS.next), f.deps);
    const burst = f.sent.slice(before);
    expect(burst.map((m) => m.kind)).toEqual(["video", "cta_url", "buttons"]);
    expect(burst[1]).toMatchObject({ url: "https://watchat.test/w/token-ep4" });
    expect(burst[2]).toMatchObject({ buttons: [{ id: IDS.optInYes }, { id: IDS.optInNo }] });
    expect(f.getState()).toMatchObject({ step: "linked", waEpisode: 3 });

    // Opt in
    await handleInbound(tap(IDS.optInYes), f.deps);
    expect(f.getOptIn()).toBe("in");

    // Tapping Next again after the chat episodes just resends the link
    await handleInbound(tap(IDS.next), f.deps);
    expect(f.sent.at(-1)).toMatchObject({ kind: "cta_url", url: "https://watchat.test/w/token-ep4" });
  });

  it("sends English-subtitle clips to viewers who chose English", async () => {
    const f = fakeDeps();
    await handleInbound(text("SECRETS01"), f.deps);
    await handleInbound(tap(IDS.langEn), f.deps);
    await handleInbound(tap(IDS.start), f.deps);
    expect(f.sent.at(-1)).toMatchObject({ header: { link: "https://cdn.example/ep1-en.mp4" } });
  });

  it("offers other series on Not for me", async () => {
    const f = fakeDeps();
    await handleInbound(text("SECRETS01"), f.deps);
    await handleInbound(tap(IDS.notForMe), f.deps);
    expect(f.sent.at(-1)).toMatchObject({ kind: "list" });
    const list = f.sent.at(-1) as Extract<OutMessage, { kind: "list" }>;
    expect(list.sections[0].rows.map((r) => r.id)).toEqual([`${IDS.seriesPrefix}DESERT02`]);
    expect(f.events).toContain("wa_dropout");
  });

  it("handles unknown codes and STOP", async () => {
    const f = fakeDeps();
    await handleInbound(text("NOPE99"), f.deps);
    expect(f.sent.at(-1)).toMatchObject({ kind: "text" });

    await handleInbound(text("stop"), f.deps);
    expect(f.getOptIn()).toBe("out");
    expect(f.sent.at(-1)).toMatchObject({ kind: "buttons", buttons: [{ id: IDS.optInYes }] });
  });

  it("answers random text with the menu", async () => {
    const f = fakeDeps();
    await handleInbound(text("مرحبا"), f.deps);
    expect(f.sent.map((m) => m.kind)).toEqual(["text", "list"]);
  });
});
