import { describe, expect, it } from "vitest";
import { compactCount, rankByViews } from "./catalogue-meta";

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
