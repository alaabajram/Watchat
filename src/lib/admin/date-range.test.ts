import { describe, expect, it } from "vitest";
import { dubaiDay, resolveRange } from "./date-range";

// 21 Nov 2026, 09:45 in Dubai.
const now = Date.parse("2026-11-21T05:45:00Z");

describe("dashboard date range (Dubai time)", () => {
  it("defaults to the last 30 days, ending today", () => {
    const r = resolveRange({}, now);
    expect(r.fromDay).toBe("2026-10-23");
    expect(r.toDay).toBe("2026-11-21");
    expect(r.to.toISOString()).toBe("2026-11-21T20:00:00.000Z"); // midnight Dubai, exclusive
  });

  it("today and this month start at Dubai midnight", () => {
    expect(resolveRange({ range: "today" }, now).from.toISOString()).toBe("2026-11-20T20:00:00.000Z");
    expect(resolveRange({ range: "month" }, now).fromDay).toBe("2026-11-01");
  });

  it("last month covers the whole previous month", () => {
    const r = resolveRange({ range: "lastmonth" }, now);
    expect([r.fromDay, r.toDay]).toEqual(["2026-10-01", "2026-10-31"]);
  });

  it("custom from–to, swapped if reversed; junk falls back to the default", () => {
    expect(resolveRange({ from: "2026-11-10", to: "2026-11-01" }, now).fromDay).toBe("2026-11-01");
    expect(resolveRange({ from: "nope", to: "2026-11-01" }, now).preset).toBe("30d");
  });

  it("keeps the old ?days= links working", () => {
    expect(resolveRange({ days: "7" }, now).preset).toBe("7d");
  });

  it("formats an instant as a Dubai calendar day", () => {
    expect(dubaiDay(Date.parse("2026-11-20T21:00:00Z"))).toBe("2026-11-21");
  });
});
