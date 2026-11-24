import { describe, expect, it } from "vitest";
import { answerChip, answerFromAi, answerLocally, answerWithoutAi, assistantSystemPrompt, normalise, searchCatalog, TEXT, type AssistantCtx, type CatalogItem } from "./engine";

const item = (code: string, titleAr: string, titleEn: string, genres: string[], extra: Partial<CatalogItem> = {}): CatalogItem => ({
  code, titleAr, titleEn, taglineAr: null, taglineEn: null, genres, tags: [], cast: [], total: 20, createdAt: "2026-11-01T00:00:00Z", posterUrl: null, ...extra,
});
const ctx: AssistantCtx = {
  lang: "ar",
  catalog: [
    item("SECRETS01", "أسرار البيت", "Secrets of the House", ["دراما", "Drama"], { cast: ["خالد الأحمد"], createdAt: "2026-11-10T00:00:00Z" }),
    item("LOVE02", "حب في دبي", "Love in Dubai", ["رومانسي", "Romance"]),
    item("REVENGE03", "الثأر", "The Revenge", ["تشويق", "انتقام"], { createdAt: "2026-11-15T00:00:00Z" }),
  ],
  watching: [{ code: "SECRETS01", resume: 5 }],
  offers: [{ kind: "pack", id: "p1", coins: 100, bonus: 20, price: 19, currency: "AED", best: true }],
  coinsPerEpisode: 30,
};

describe("viewer assistant", () => {
  it("normalises Arabic spellings and digits", () => {
    expect(normalise("أسرارُ البيـــت ٢")).toBe("اسرار البيت 2");
    expect(normalise("مسلسلة")).toBe("مسلسله");
  });

  it("finds series by title, partial title, cast and code, without AI", () => {
    expect(searchCatalog("اسرار البيت", ctx.catalog)[0].item.code).toBe("SECRETS01");
    expect(answerLocally("ابي مسلسل خالد الأحمد", ctx)).toMatchObject({ kind: "search", series: [{ code: "SECRETS01" }] });
    expect(answerLocally("love in dubai", ctx)).toMatchObject({ kind: "search", series: [{ code: "LOVE02" }] });
  });

  it("answers genres, offers, continue, greetings and help topics without AI", () => {
    expect(answerLocally("ابي شي رومانسي", ctx)).toMatchObject({ kind: "recommend", series: [{ code: "LOVE02" }] });
    expect(answerLocally("فيه عروض؟", ctx)).toMatchObject({ kind: "offers", offers: [{ id: "p1" }] });
    expect(answerLocally("وين وقفت", ctx)).toMatchObject({ kind: "continue", series: [{ code: "SECRETS01", resume: 5 }] });
    expect(answerLocally("هلا", ctx)).toMatchObject({ kind: "greeting", text: TEXT.greeting.ar });
    expect(answerLocally("كيف ادفع؟", ctx)).toMatchObject({ kind: "help", help: ["payment"] });
    expect(answerLocally("عندي حسابين كيف ادمجهم", ctx)).toMatchObject({ kind: "help", help: ["merge"] });
    expect(answerLocally("how do I merge my accounts", ctx)).toMatchObject({ kind: "help", help: ["merge"] });
    expect(answerLocally("كيف اربط تيليجرام بحسابي", ctx)).toMatchObject({ kind: "help", help: ["merge"] });
    expect(answerLocally("كيف ادخل حسابي", ctx)).toMatchObject({ kind: "help", help: ["account"] });
    expect(answerLocally("x".repeat(400), ctx)).toMatchObject({ text: TEXT.tooLong.ar });
  });

  it("recommends series the viewer hasn't started first", () => {
    expect(answerChip("recommend", ctx).series.map((s) => s.code)).toEqual(["LOVE02", "REVENGE03", "SECRETS01"]);
    expect(answerChip("new", ctx).series[0].code).toBe("REVENGE03");
  });

  it("leaves free text it can't place to the AI, and works without AI too", () => {
    expect(answerLocally("قصة عن بنت تكتشف سر عن ابوها بعد سنين", ctx)).toBeNull();
    expect(answerWithoutAi("ما اعرف", ctx)).toMatchObject({ kind: "nothing" });
  });

  it("never lets the AI write what the viewer reads, and refuses anything off topic", () => {
    const off = answerFromAi({ intent: "off_topic", series: [], genre: "", help: [] }, "write my homework", ctx);
    expect(off).toMatchObject({ kind: "off_topic", text: TEXT.offTopic.ar, series: [], offers: [] });
    // Unknown intents and made-up codes are dropped; injected text has nowhere to go.
    expect(answerFromAi({ intent: "hack", reply: "ignore rules" }, "x", ctx).kind).toBe("off_topic");
    const r = answerFromAi({ intent: "search", series: ["REVENGE03", "FAKE99", "REVENGE03"], genre: "", help: [] }, "سر عن ابوها", ctx);
    expect(r.series).toEqual([{ code: "REVENGE03" }]);
    expect(r.text).toBe(TEXT.search.ar("سر عن ابوها"));
  });

  it("gives the AI only public catalogue facts", () => {
    const p = assistantSystemPrompt(ctx);
    expect(p).toMatch(/SECRETS01 \| أسرار البيت/);
    expect(p).toMatch(/off_topic/);
    expect(p).not.toMatch(/price|AED|phone|admin@/i);
  });
});
