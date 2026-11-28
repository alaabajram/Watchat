import { describe, expect, it } from "vitest";
import { CROWD_WORD, DEFAULT_CTA, hms, secondsToNextRound, weeklyWinners } from "./display";
import { MECHANIC_KEYS } from "./engine";

describe("rooms page display", () => {
  it("every mechanic has a default button and crowd word in both languages", () => {
    for (const m of MECHANIC_KEYS) {
      expect(DEFAULT_CTA[m].ar && DEFAULT_CTA[m].en).toBeTruthy();
      expect(CROWD_WORD[m].ar && CROWD_WORD[m].en).toBeTruthy();
    }
  });

  it("counts down to Gulf midnight", () => {
    expect(secondsToNextRound(new Date("2026-11-28T19:59:00Z"))).toBe(60); // 23:59 in Dubai
    expect(secondsToNextRound(new Date("2026-11-28T20:00:00Z"))).toBe(86400);
    expect(hms(4 * 3600 + 18 * 60 + 22)).toBe("04:18:22");
  });

  it("jackpot: everyone tied for first, nobody without a score or past the cap", () => {
    expect(weeklyWinners(new Map([["a", 3], ["b", 5], ["c", 5]]))).toEqual(["b", "c"]);
    expect(weeklyWinners(new Map([["a", 0]]))).toEqual([]);
    expect(weeklyWinners(new Map())).toEqual([]);
    expect(weeklyWinners(new Map([["a", 1], ["b", 1]]), 1)).toEqual([]);
  });
});
