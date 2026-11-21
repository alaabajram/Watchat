import { describe, expect, it } from "vitest";
import { chatFabHidden } from "./ChatFab";

describe("chat button placement", () => {
  it("shows on viewer pages", () => {
    for (const p of ["/", "/list", "/series/SECRETS01", "/store", "/wallet", "/rewards", "/me", "/settings"]) expect(chatFabHidden(p)).toBe(false);
  });
  it("stays off the full-screen watch feed, the assistant and admin", () => {
    for (const p of ["/watch/SECRETS01/3", "/assistant", "/admin/pricing", "/business", "/w/abc", "/payment/return", "/tg"]) expect(chatFabHidden(p)).toBe(true);
  });
});
