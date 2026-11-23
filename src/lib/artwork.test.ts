import { describe, expect, it } from "vitest";
import { fillKeeps, fillSource, fitTarget, suggestedMode } from "./artwork";

describe("artwork from a master", () => {
  it("fills around the focus point without leaving the picture", () => {
    // 1000×1500 poster → 1920×1080 banner keeps a 1000×562.5 band
    const r = fillSource(1000, 1500, 1920, 1080, 0.5, 0.3);
    expect(r.w).toBe(1000);
    expect(r.h).toBeCloseTo(562.5);
    expect(r.y).toBeCloseTo(450 - 281.25);
    expect(fillSource(1000, 1500, 1920, 1080, 0.5, 0).y).toBe(0);
    expect(fillSource(1000, 1500, 1920, 1080, 0.5, 1).y).toBeCloseTo(1500 - 562.5);
  });

  it("fits the whole picture in the middle", () => {
    expect(fitTarget(1000, 1500, 1920, 1080)).toEqual({ x: 600, y: 0, w: 720, h: 1080 });
    const m = fitTarget(1000, 1500, 1920, 1080, 0.05);
    expect(m.h).toBeCloseTo(972);
  });

  it("suggests cutting for similar shapes and the whole picture for very different ones", () => {
    expect(fillKeeps(1000, 1500, 1000, 1500)).toBe(1);
    expect(suggestedMode(1000, 1500, 1080, 1080)).toBe("fill"); // square keeps 67%
    expect(suggestedMode(1000, 1500, 1920, 1080)).toBe("fit"); // wide keeps 37%
    expect(suggestedMode(1920, 1080, 1000, 1500)).toBe("fit");
  });
});
