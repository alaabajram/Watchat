import { describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ db: vi.fn() }));
vi.mock("./env", () => ({ env: { appUrl: "https://watchat.test" } }));

describe("personal link sign-in rules", async () => {
  const { canSignIn, isFresh } = await import("./links");
  const now = Date.parse("2026-11-20T12:00:00Z");
  const link = (minutesAgo: number, usesLeft = 1, expired = false) => ({
    viewerId: "v1",
    seriesId: "s1",
    episodeNumber: 4,
    mintedAt: now - minutesAgo * 60_000,
    usesLeft,
    expired,
  });

  it("signs in only on the first open within 24 hours", () => {
    expect(canSignIn(link(5), now)).toBe(true);
    expect(canSignIn(link(23 * 60), now)).toBe(true);
    expect(canSignIn(link(25 * 60), now)).toBe(false); // too old → continue in WhatsApp
    expect(canSignIn(link(5, 0), now)).toBe(false); // already opened (e.g. forwarded) → continue in WhatsApp
    expect(canSignIn(link(5, 1, true), now)).toBe(false);
  });

  it("trusts the device only when opened within 30 minutes", () => {
    expect(isFresh(link(10), now)).toBe(true);
    expect(isFresh(link(45), now)).toBe(false);
  });
});
