import { describe, expect, it } from "vitest";
import { GROWTH_TOOL, autopilotReadiness, growthSystemPrompt, validateDecisions, type Catalog, type ViewerSummary } from "./agent";

const catalog: Catalog = {
  series: [
    { code: "SECRETS01", title: "أسرار البيت", episodes: 30, freeUntil: 9 },
    { code: "DESERT02", title: "رمال", episodes: 20, freeUntil: 9 },
    { code: "SEA03", title: "بحر", episodes: 25, freeUntil: 9 },
  ],
  templates: [
    { name: "resume_reminder", category: "marketing", body: "لسه ما خلصت «{{1}}»", quickReply: false },
    { name: "series_picks", category: "marketing", body: "اخترنا لك", quickReply: true },
  ],
};
const viewer = (ref: string, patch: Partial<ViewerSummary> = {}): ViewerSummary => ({
  ref,
  language: "ar",
  country: "AE",
  daysSinceActive: 3,
  paid: false,
  series: [
    { code: "SECRETS01", title: "أسرار البيت", episodes: 30, watchedUpTo: 6, finished: false, lastWatchedDaysAgo: 5 },
    { code: "DESERT02", title: "رمال", episodes: 20, watchedUpTo: 1, finished: false, lastWatchedDaysAgo: 3 },
  ],
  recentMessages: [],
  pastSuggestions: [],
  ...patch,
});

describe("growth agent decisions", () => {
  it("accepts a next-episode hint for the series they were hooked on", () => {
    const [d] = validateDecisions(
      { decisions: [{ ref: "v1", action: "template", template: "resume_reminder", series: "secrets01", episode: 7, picks: [], reason: "Hooked on SECRETS01 (6 eps), bounced off DESERT02.", priority: 1 }] },
      [viewer("v1")],
      catalog,
    );
    expect(d).toMatchObject({ action: "template", template: "resume_reminder", series: "SECRETS01", episode: 7, priority: 1 });
  });

  it("turns anything it can't send into a team flag, and fills in missing viewers", () => {
    const out = validateDecisions(
      {
        decisions: [
          { ref: "v1", action: "template", template: "made_up", series: "SECRETS01", episode: 7, picks: [], reason: "x", priority: 2 },
          { ref: "v2", action: "series_picks", template: "", series: "", episode: 0, picks: ["SECRETS01", "NOPE99"], reason: "y", priority: 2 },
        ],
      },
      [viewer("v1"), viewer("v2", { series: [{ code: "SECRETS01", title: "", episodes: 30, watchedUpTo: 30, finished: true, lastWatchedDaysAgo: 4 }] }), viewer("v3")],
      catalog,
    );
    expect(out[0]).toMatchObject({ action: "flag" });
    expect(out[0].reason).toMatch(/isn't an approved template/);
    expect(out[1]).toMatchObject({ action: "flag" }); // finished SECRETS01 + unknown code leaves < 2 picks
    expect(out[2]).toMatchObject({ action: "none" });
  });

  it("offers 2–3 live, unfinished series as picks", () => {
    const [d] = validateDecisions(
      { decisions: [{ ref: "v1", action: "series_picks", template: "", series: "", episode: 0, picks: ["SEA03", "DESERT02", "SEA03"], reason: "z", priority: 2 }] },
      [viewer("v1")],
      catalog,
    );
    expect(d).toMatchObject({ action: "series_picks", template: "series_picks", picks: ["SEA03", "DESERT02"] });
  });

  it("learns from reviews, and earns autopilot", () => {
    const p = growthSystemPrompt(catalog, {
      reviews: [{ action: "template", template: "resume_reminder", approved: false, note: "Too soon after the last message", reason: "r" }],
      results: [{ key: "template:resume_reminder", sent: 20, cameBack: 7 }],
      holdout: { reviewed: 10, cameBack: 1 },
    });
    expect(p).toContain("Too soon after the last message");
    expect(p).toContain("35% came back");
    expect(autopilotReadiness(20, 20).ready).toBe(false);
    expect(autopilotReadiness(60, 30).ready).toBe(false);
    expect(autopilotReadiness(60, 50).ready).toBe(true);
    // Strict tool limits: every field required
    const item = (GROWTH_TOOL.input_schema.properties as Record<string, { items: { required: string[]; properties: object } }>).decisions.items;
    expect(item.required.sort()).toEqual(Object.keys(item.properties).sort());
  });
});
