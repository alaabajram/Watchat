import { describe, expect, it } from "vitest";
import { STARTER_PEOPLE } from "./persona";
import { affinityLevel, groupKey, heroGroups, sanitizeStats, STARTER_CARDS, statsText, toCard, cardRow } from "./card";

describe("hero cards", () => {
  it("every starter person has a card with a button and at most three stats", () => {
    for (const p of STARTER_PEOPLE) {
      const c = STARTER_CARDS[p.slug];
      expect(c, p.slug).toBeTruthy();
      expect(c.ctaAr && c.ctaEn).toBeTruthy();
      expect(c.stats.length).toBeLessThanOrEqual(3);
    }
  });

  it("stats parse from admin lines and round-trip", () => {
    const s = sanitizeStats("الحدس | Intuition | 98%\nbad line\nأ | B | 1\nج | C | 2\nد | D | 3");
    expect(s).toHaveLength(3);
    expect(s[0]).toEqual({ ar: "الحدس", en: "Intuition", value: "98%" });
    expect(sanitizeStats(statsText(s))).toEqual(s);
  });

  it("card fields survive the database round trip", () => {
    const c = STARTER_CARDS.layla;
    expect(toCard(cardRow(c))).toEqual(c);
  });

  it("affinity grows every 5 messages, capped", () => {
    expect(affinityLevel(0)).toBe(1);
    expect(affinityLevel(4)).toBe(1);
    expect(affinityLevel(5)).toBe(2);
    expect(affinityLevel(100000)).toBe(99);
  });

  it("groups become tabs with counts, in order", () => {
    const g = heroGroups([{ groupAr: "أ", groupEn: "Street & banter" }, { groupAr: "ب", groupEn: "Mythic & story" }, { groupAr: "أ", groupEn: "Street & banter" }, { groupAr: "", groupEn: "" }]);
    expect(g.map((x) => [x.key, x.count])).toEqual([["street-banter", 2], ["mythic-story", 1]]);
    expect(groupKey("سوالف الشارع")).toBe("سوالف-الشارع");
  });
});
