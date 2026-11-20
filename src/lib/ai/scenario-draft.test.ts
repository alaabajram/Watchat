import { describe, expect, it } from "vitest";
import { COPY, COPY_KEYS } from "../bot/copy";
import { simulateChat } from "../bot/simulate";
import type { Series } from "../bot/flow";
import { SCENARIO_TOOL, systemPrompt, validateDraft, type DraftContext } from "./scenario-draft";

const ctx: DraftContext = {
  series: { code: "SECRETS01", titleAr: "أسرار", titleEn: "Secrets", synopsisAr: null, synopsisEn: null, dialect: "gulf", episodeCount: 30, hasTrailer: false },
  scenario: { askLanguage: true, sendTrailer: false, askOptIn: true, waEpisodeCount: 3 },
  texts: Object.fromEntries(COPY_KEYS.map((k) => [k, { ar: COPY[k].ar, en: COPY[k].en, custom: false }])) as DraftContext["texts"],
};

describe("AI scenario drafts", () => {
  it("keeps valid changes and drops unchanged ones", () => {
    const { draft, problems } = validateDraft(
      {
        summary: "Arabic only, punchier cliffhanger.",
        scenario: { askLanguage: false, askOptIn: true, waEpisodeCount: 2 },
        messages: [
          { key: "btnNext", ar: "كمّل 🔥", en: "Keep going 🔥" },
          { key: "episodeCaption", ar: COPY.episodeCaption.ar, en: COPY.episodeCaption.en },
        ],
        notes: "",
      },
      ctx,
    );
    expect(problems).toEqual([]);
    expect(draft.scenario).toEqual({ askLanguage: false, waEpisodeCount: 2 }); // askOptIn unchanged → dropped
    expect(draft.messages.map((m) => m.key)).toEqual(["btnNext"]);
  });

  it("rejects WhatsApp limit breaks, unknown placeholders, unknown keys and a trailer that doesn't exist", () => {
    const { draft, problems } = validateDraft(
      {
        summary: "",
        scenario: { sendTrailer: true, waEpisodeCount: 9 },
        messages: [
          { key: "btnNext", ar: "الحلقة التالية مباشرة الآن", en: "Next" },
          { key: "episodeCaption", ar: "الحلقة {n} {price}", en: "Episode {n}" },
          { key: "madeUp", ar: "x", en: "x" },
        ],
        notes: "",
      },
      ctx,
    );
    expect(draft.messages).toEqual([]);
    expect(draft.scenario).toEqual({});
    expect(problems.join(" ")).toMatch(/btnNext \(ar\) is \d+ characters/);
    expect(problems.join(" ")).toMatch(/\{price\}/);
    expect(problems.join(" ")).toMatch(/madeUp/);
    expect(problems.join(" ")).toMatch(/no trailer/);
    expect(problems.join(" ")).toMatch(/waEpisodeCount/);
  });

  it("tells the model every key, its limit and the series", () => {
    const prompt = systemPrompt(ctx);
    for (const k of COPY_KEYS) expect(prompt).toContain(`key: ${k}`);
    expect(prompt).toContain("SECRETS01");
    expect(SCENARIO_TOOL.input_schema.required).toContain("messages");
  });

  it("previews the real chat with a draft applied", async () => {
    const series: Series = {
      id: "s1", code: "SECRETS01", titleAr: "أسرار", titleEn: "Secrets", posterUrl: null, trailerUrl: null,
      episodeCount: 30, waEpisodeCount: 2, askLanguage: false, sendTrailer: false, askOptIn: true,
    };
    const turns = await simulateChat(series, { ar: { btnNext: "كمّل 🔥" }, en: {} }, "ar");
    const bot = turns.filter((t) => t.from === "bot");
    expect(bot.some((t) => t.msg.kind === "buttons" && t.msg.buttons.some((b) => b.title === "كمّل 🔥"))).toBe(true);
    expect(bot.some((t) => t.msg.kind === "cta_url")).toBe(true); // ends with the web link
  });
});
