import { describe, expect, it } from "vitest";
import { EMOJI_GROUPS, insertText, searchEmoji } from "./emoji";

describe("emoji picker", () => {
  it("inserts at the cursor, replacing a selection", () => {
    expect(insertText("ابدأ الآن", 4, 4, " 🔥")).toEqual({ value: "ابدأ 🔥 الآن", caret: 7 });
    expect(insertText("Next episode", 0, 4, "👉")).toEqual({ value: "👉 episode", caret: 2 });
    expect(insertText("Hi", null, null, "👋")).toEqual({ value: "Hi👋", caret: 4 });
  });

  it("finds emoji by English or Arabic words", () => {
    expect(searchEmoji("heart")).toContain("❤️");
    expect(searchEmoji("رمضان")).toContain("🌙");
    expect(searchEmoji("")).toEqual([]);
  });

  it("has no duplicates within a group", () => {
    for (const g of EMOJI_GROUPS) expect(new Set(g.items.map((i) => i[0])).size).toBe(g.items.length);
  });
});
