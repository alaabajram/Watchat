import { describe, expect, it } from "vitest";
import { compactCount, isSeriesKind, kindLabel, rankByViews, seriesKind } from "./catalogue-meta";

describe("catalogue ranking", () => {
  it("ranks by viewers and skips series nobody watched", () => {
    const r = rankByViews(new Map([["a", 5], ["b", 120], ["c", 0], ["d", 40]]));
    expect([...r.entries()]).toEqual([["b", 1], ["d", 2], ["a", 3]]);
    expect(r.has("c")).toBe(false);
  });
  it("shows compact counts", () => {
    expect(compactCount(42500)).toBe("42.5K");
    expect(compactCount(890)).toBe("890");
  });
});


describe("series kinds", () => {
  it("maps video series to micro drama and story looks to their kind", () => {
    expect(seriesKind("video", "chat")).toBe("micro_drama");
    expect(seriesKind(null, null)).toBe("micro_drama");
    expect(seriesKind("story", "chat")).toBe("chat");
    expect(seriesKind("story", "photo")).toBe("photo");
    expect(seriesKind("story", "weird")).toBe("visual_novel");
    expect(kindLabel("motion_comic", "en")).toBe("Motion comic");
    expect(isSeriesKind("micro_drama")).toBe(true);
    expect(isSeriesKind("anime")).toBe(false);
  });
});
