import { describe, expect, it } from "vitest";
import { readiness, suggestCode } from "./readiness";

const base = { title_ar: "سر", title_en: "Secret", poster_url: "p", wa_episode_count: 2, free_web_until_ep: 3, coins_per_episode: 10 };
const ep = (number: number, video = true, wa = true) => ({ number, status: "draft", stream_uid: video ? `v${number}` : null, wa_video_url_ar: wa ? "w" : null });

describe("series readiness", () => {
  it("is ready when the required items are done", () => {
    const r = readiness(base, [ep(1), ep(2), ep(3), ep(4)], 1, "approved");
    expect(r.ready).toBe(true);
    expect(r.summary).toBe("Ready to publish");
  });
  it("lists what's missing", () => {
    const r = readiness({ ...base, poster_url: null }, [ep(1), ep(2, true, false), ep(3, false)], 0, null);
    expect(r.items.filter((i) => i.required && !i.done).map((i) => i.key)).toEqual(["poster", "videos", "chat", "licence", "review"]);
    expect(r.summary).toBe("5 things left before publishing");
  });
  it("lets later episodes wait for their video", () => {
    const r = readiness(base, [ep(1), ep(2), ep(3), ep(4, false, false)], 1, "approved");
    expect(r.ready).toBe(true);
    expect(r.items.find((i) => i.key === "videos")?.detail).toContain("stay hidden");
  });
  it("doesn't need WhatsApp versions when no episodes go in the chat", () => {
    const r = readiness({ ...base, wa_episode_count: 0 }, [ep(1, true, false)], 1, "approved");
    expect(r.items.find((i) => i.key === "chat")?.required).toBe(false);
  });
});

describe("suggestCode", () => {
  it("makes a free code from the English title", () => {
    expect(suggestCode("Desert Secrets", [])).toBe("DESERT01");
    expect(suggestCode("Desert Secrets", ["DESERT01"])).toBe("DESERT02");
    expect(suggestCode("Oh", [])).toBe("OHX01");
  });
});
