import { describe, expect, it } from "vitest";
import { computeSpend, DEFAULT_RATES, gulfMonth, marketFromPhone, mergeRates, meterLevel, projectMonth, type SpendGroup } from "./meter";

const g = (p: Partial<SpendGroup>): SpendGroup => ({ day: "2026-11-02", source: "bot", market: "SA", category: "service", template_name: null, state: "billable", n: 1, ...p });

describe("spend meter", () => {
  it("prices by category and market, and gives the first 1,000 service replies free", () => {
    const s = computeSpend(
      [
        g({ n: 1200, day: "2026-11-01" }), // 1,000 free, 200 charged at SA service
        g({ category: "marketing", template_name: "come_back", source: "flow", n: 100 }),
        g({ market: "AE", category: "utility", template_name: "receipt", n: 10 }),
      ],
      DEFAULT_RATES,
    );
    expect(s.free.allowance).toBe(1000);
    expect(s.byCategory.service.count).toBe(200);
    expect(s.byCategory.service.cost).toBeCloseTo(200 * 0.0107);
    expect(s.byCategory.marketing.cost).toBeCloseTo(100 * 0.06624);
    expect(s.byCategory.utility.cost).toBeCloseTo(10 * 0.01806);
    expect(s.total).toBeCloseTo(200 * 0.0107 + 100 * 0.06624 + 10 * 0.01806);
    expect(s.byTemplate[0]).toMatchObject({ name: "come_back", count: 100 });
    expect(s.bySource.flow.cost).toBeCloseTo(100 * 0.06624);
  });

  it("counts free and failed messages without charging them", () => {
    const s = computeSpend(
      [
        g({ state: "free_entry_point", n: 50 }),
        g({ state: "free_customer_service", category: "utility", n: 5 }),
        g({ category: "referral_conversion", state: "free", n: 3 }),
        g({ state: "failed", category: "marketing", n: 7 }),
      ],
      DEFAULT_RATES,
    );
    expect(s.total).toBe(0);
    expect(s.free).toMatchObject({ entryPoint: 53, customerService: 5 });
    expect(s.failed).toBe(7);
    expect(s.messages).toBe(58);
  });

  it("costs messages Meta hasn't priced yet as an estimate", () => {
    const s = computeSpend([g({ state: "pending", category: "marketing", n: 10 })], DEFAULT_RATES, 0);
    expect(s.estimated).toBeCloseTo(10 * 0.06624);
    expect(s.estimated).toBeCloseTo(s.total);
  });

  it("maps numbers to markets and keeps valid rate overrides only", () => {
    expect(marketFromPhone("966500000000")).toBe("SA");
    expect(marketFromPhone("+971 50 000 0000")).toBe("AE");
    expect(marketFromPhone("201000000000")).toBe("EG");
    expect(marketFromPhone("97333333333")).toBe("ME_REST");
    expect(marketFromPhone("447700900000")).toBe("OTHER");
    const r = mergeRates({ SA: { marketing: 0.05, service: "x" }, ZZ: { marketing: 1 } });
    expect(r.SA.marketing).toBe(0.05);
    expect(r.SA.service).toBe(DEFAULT_RATES.SA.service);
  });

  it("projects the month and sets the meter level", () => {
    const { start, end } = gulfMonth(new Date("2026-11-10T08:00:00Z"));
    expect(start.toISOString()).toBe("2026-10-31T20:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-30T20:00:00.000Z");
    const mid = new Date(start.getTime() + (end.getTime() - start.getTime()) / 2);
    expect(projectMonth(100, mid, start, end)).toBeCloseTo(200);
    expect(meterLevel(50, 100, 80)).toBe("ok");
    expect(meterLevel(85, 100, 80)).toBe("alert");
    expect(meterLevel(100, 100, 80)).toBe("over");
    expect(meterLevel(500, null, 80)).toBe("ok");
  });
});
