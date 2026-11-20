import { describe, expect, it } from "vitest";
import type { InboundMessage } from "../whatsapp/inbound";
import type { OutMessage } from "../whatsapp/messages";
import { EMPTY_STATE, handleInbound, type BotDeps, type ChatState, type Series, type ViewerLang } from "./flow";
import { COPY, COPY_KEYS, type CopyKey, type CopyOverrides } from "./copy";
import { defaultFlow } from "../flows/defaults";
import { IDS } from "./intents";
import type { FlowGraph } from "../flows/types";
import type { FlowRun } from "./flow";

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
function fakeDeps(opts: { series?: Partial<Series>; overrides?: CopyOverrides; validCode?: string; flow?: FlowGraph } = {}) {
  const series: Series = { ...SERIES, ...opts.series };
  const sent: OutMessage[] = [];
  const events: string[] = [];
  let state: ChatState = EMPTY_STATE;
  let language: ViewerLang | null = null;
  let optIn: "in" | "out" | null = null;
  let run: FlowRun | null = null;
  const texts = Object.fromEntries(
    COPY_KEYS.map((k) => [k, { ar: opts.overrides?.[k] ?? COPY[k].ar, en: opts.overrides?.[k] ?? COPY[k].en }]),
  ) as Record<CopyKey, { ar: string; en: string }>;
  const flow =
    opts.flow ??
    defaultFlow({ askLanguage: true, sendTrailer: true, hasTrailer: Boolean(series.trailerUrl), askOptIn: true, waEpisodeCount: series.waEpisodeCount, episodeCount: series.episodeCount, texts });

  const deps: BotDeps = {
    upsertViewer: async (m) => ({ id: "v1", waId: m.from, language }),
    getChatState: async () => state,
    saveChatState: async (_id, s) => {
      state = s;
    },
    setViewerLanguage: async (_id, l) => {
      language = l;
    },
    findSeriesByCode: async (code) => [series, OTHER].find((s) => s.code === code) ?? null,
    getSeries: async (id) => [series, OTHER].find((s) => s.id === id) ?? null,
    getClip: async (_sid, n) => ({
      number: n,
      titleAr: null,
      titleEn: null,
      videoUrlAr: `https://cdn.example/ep${n}-ar.mp4`,
      videoUrlEn: `https://cdn.example/ep${n}-en.mp4`,
    }),
    listOtherSeries: async (exclude) => [series, OTHER].filter((s) => s.id !== exclude),
    getCopyOverrides: async () => opts.overrides ?? {},
    confirmSpendCode: async (_v, code) => code === opts.validCode,
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
    // Like production: the series' flow, or the standard flow published automatically.
    getPublishedFlow: async (sid) => (sid === series.id ? { versionId: "ver1", graph: flow } : null),
    getFlowVersion: async (id) => (id === "ver1" ? flow : null),
    getFlowRun: async () => run,
    saveFlowRun: async (_v, r) => {
      run = r;
    },
    sendFlowTemplate: async () => "sent",
    checkCondition: async (_v, _s, c) => c.check === "opted_in" && optIn === "in",
  };
  return { deps, sent, events, getState: () => state, getOptIn: () => optIn, getLanguage: () => language, getRun: () => run };
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

/** Tap button number `i` on the last message the bot sent. */
async function tapButton(f: ReturnType<typeof fakeDeps>, i: number) {
  const last = f.sent.at(-1) as Extract<OutMessage, { kind: "buttons" }>;
  await handleInbound(tap(last.buttons[i].id), f.deps);
}

describe("bot flow: series code to cliffhanger link", () => {
  it("runs the standard flow: language → trailer → episodes 1–3 → link → alerts", async () => {
    const f = fakeDeps();

    // Series code from a Click-to-WhatsApp ad → language choice (with the poster)
    await handleInbound(text("Hi! I want to watch SECRETS01", true), f.deps);
    expect(f.sent.at(-1)).toMatchObject({ kind: "buttons", header: { type: "image", link: SERIES.posterUrl } });
    expect(f.events).toEqual(expect.arrayContaining(["chat_started", "flow_started"]));
    expect(f.getState()).toMatchObject({ seriesId: "s1", step: "flow" });

    // Arabic → trailer with Start / Not for me
    await tapButton(f, 0);
    expect(f.getLanguage()).toBe("ar");
    expect(f.sent.at(-1)).toMatchObject({ kind: "buttons", header: { type: "video", link: SERIES.trailerUrl } });

    // Start → episode 1, Next → episode 2
    await tapButton(f, 0);
    expect(f.sent.at(-1)).toMatchObject({ kind: "buttons", header: { link: "https://cdn.example/ep1-ar.mp4" } });
    await tapButton(f, 0);
    expect(f.sent.at(-1)).toMatchObject({ kind: "buttons", header: { link: "https://cdn.example/ep2-ar.mp4" } });

    // Next → episode 3 as a plain video, the personal link to episode 4, then the alerts question
    const before = f.sent.length;
    await tapButton(f, 0);
    const burst = f.sent.slice(before);
    expect(burst.map((m) => m.kind)).toEqual(["video", "cta_url", "buttons"]);
    expect(burst[1]).toMatchObject({ url: "https://watchat.test/w/token-ep4" });

    await tapButton(f, 0);
    expect(f.getOptIn()).toBe("in");
    expect(f.getRun()).toMatchObject({ status: "done" });

    // An old "Next" button from before flows just sends the viewer's link
    await handleInbound(tap(IDS.next), f.deps);
    expect(f.sent.at(-1)).toMatchObject({ kind: "cta_url", url: "https://watchat.test/w/token-ep4" });
  });

  it("sends English-subtitle clips to viewers who chose English", async () => {
    const f = fakeDeps();
    await handleInbound(text("SECRETS01"), f.deps);
    await tapButton(f, 1); // English subtitles
    await tapButton(f, 0); // Start
    expect(f.getLanguage()).toBe("ar_en_subs");
    expect(f.sent.at(-1)).toMatchObject({ header: { link: "https://cdn.example/ep1-en.mp4" } });
  });

  it("offers other series on Not for me", async () => {
    const f = fakeDeps();
    await handleInbound(text("SECRETS01"), f.deps);
    await tapButton(f, 0); // Arabic
    await tapButton(f, 1); // Not for me
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

  it("logs a data deletion request and turns alerts off", async () => {
    const f = fakeDeps();
    await handleInbound(text("Delete my data"), f.deps);
    expect(f.events).toContain("data_deletion_requested");
    expect(f.getOptIn()).toBe("out");
    expect(f.sent.at(-1)).toMatchObject({ kind: "text" });
  });

  it("builds the standard flow from the current default texts", async () => {
    const f = fakeDeps({ overrides: { trailerBody: "Custom trailer for {title}" } });
    await handleInbound(text("SECRETS01"), f.deps);
    await tapButton(f, 0);
    expect(f.sent.at(-1)).toMatchObject({ kind: "buttons", body: "Custom trailer for أسرار البيت" });
  });

  it("skips the trailer when the series has none", async () => {
    const f = fakeDeps({ series: { trailerUrl: null } });
    await handleInbound(text("SECRETS01"), f.deps);
    await tapButton(f, 0); // Arabic → straight to episode 1
    expect(f.sent.at(-1)).toMatchObject({ kind: "buttons", header: { link: "https://cdn.example/ep1-ar.mp4" } });
  });

  it("confirms a device with the right code only", async () => {
    const f = fakeDeps({ validCode: "123456" });
    await handleInbound(text("CONFIRM 999999"), f.deps);
    expect(f.events).not.toContain("device_confirmed");
    await handleInbound(text("confirm 123456"), f.deps);
    expect(f.events).toContain("device_confirmed");
  });

  it("sends a shared-link receiver their own link, not the sender's", async () => {
    const f = fakeDeps();
    await handleInbound(text("WATCH SECRETS01 4"), f.deps);
    // A personal link minted for THIS number, straight to episode 4, no chat episodes.
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]).toMatchObject({ kind: "cta_url", url: "https://watchat.test/w/token-ep4" });
    expect(f.getState()).toMatchObject({ seriesId: "s1", step: "linked", waEpisode: 3 });
  });

  it("follows a custom flow drawn in the builder", async () => {
    const flow: FlowGraph = {
      v: 1,
      nodes: [
        { id: "s", position: { x: 0, y: 0 }, data: { kind: "start" } },
        {
          id: "q",
          position: { x: 0, y: 0 },
          data: {
            kind: "message",
            body: { ar: "تبي تشوف؟", en: "Want to watch?" },
            buttons: [
              { id: "yes", title: { ar: "إيه", en: "Yes" } },
              { id: "no", title: { ar: "لا", en: "No" } },
            ],
            media: null,
          },
        },
        { id: "e1", position: { x: 0, y: 0 }, data: { kind: "episode", episode: 1, caption: { ar: "الحلقة {n}", en: "Episode {n}" }, buttons: [] } },
        { id: "w", position: { x: 0, y: 0 }, data: { kind: "wait", minutes: 120 } },
      ],
      edges: [
        { id: "1", source: "s", sourceHandle: "next", target: "q" },
        { id: "2", source: "q", sourceHandle: "yes", target: "e1" },
        { id: "3", source: "e1", sourceHandle: "next", target: "w" },
      ],
    };
    const f = fakeDeps({ flow });
    await handleInbound(text("SECRETS01"), f.deps);
    expect(f.sent.at(-1)).toMatchObject({ kind: "buttons", body: "تبي تشوف؟", buttons: [{ id: "f:q:yes" }, { id: "f:q:no" }] });
    expect(f.getRun()).toMatchObject({ nodeId: "q", status: "input", versionId: "ver1" });
    expect(f.events).toContain("flow_started");

    await handleInbound(tap("f:q:yes"), f.deps);
    expect(f.sent.at(-1)).toMatchObject({ kind: "video", link: "https://cdn.example/ep1-ar.mp4", caption: "الحلقة 1" });
    expect(f.getRun()).toMatchObject({ nodeId: "w", status: "wait" });
    expect(f.getRun()?.resumeAt).toBeTruthy();
  });

  it("answers random text with the menu", async () => {
    const f = fakeDeps();
    await handleInbound(text("مرحبا"), f.deps);
    expect(f.sent.map((m) => m.kind)).toEqual(["text", "list"]);
  });
});
