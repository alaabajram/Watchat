import { describe, expect, it } from "vitest";
import { ctr, flowSummary, health } from "./ctr";

describe("CTR meter", () => {
  it("waits for a minimum sample, then grades", () => {
    expect(health(0, 0, "message")).toBe("none");
    expect(health(1, 10, "message")).toBe("early");
    expect(health(10, 50, "message")).toBe("good"); // 20%
    expect(health(5, 50, "message")).toBe("ok"); // 10%
    expect(health(2, 50, "message")).toBe("low"); // 4%
    expect(health(5, 25, "card")).toBe("ok"); // 20%
    expect(health(3, 25, "card")).toBe("low");
    expect(ctr(3, 0)).toBeNull();
    expect(ctr(30, 20)).toBe(1);
  });

  it("sums clickable cards only and finds the weakest one", () => {
    const s = flowSummary(
      { a: { reached: 100, clicked: 60 }, b: { reached: 100, clicked: 10 }, c: { reached: 5, clicked: 0 }, w: { reached: 100, clicked: 0 } },
      { a: "language", b: "link", c: "episode", w: "wait" },
    );
    expect(s).toEqual({ reached: 205, clicked: 70, weakest: "b" });
  });
});
