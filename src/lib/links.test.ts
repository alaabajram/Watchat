import { describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ db: vi.fn() }));
vi.mock("./env", () => ({ env: { appUrl: "https://watchat.test" } }));

describe("personal link sign-in rules", async () => {
  const { canSignIn, isFresh, opensTrusted, LINK_TTL_DAYS } = await import("./links");
  const now = Date.parse("2026-11-20T12:00:00Z");
  const link = (minutesAgo: number, usesLeft = 1, expired = false) => ({
    viewerId: "v1",
    seriesId: "s1",
    episodeNumber: 4,
    mintedAt: now - minutesAgo * 60_000,
    usesLeft,
    expired,
  });

  it("signs the owner in on every open until the link expires (pinned links keep working)", () => {
    expect(canSignIn(link(5), now)).toBe(true);
    expect(canSignIn(link(5, 0), now)).toBe(true); // re-opened (e.g. from a pinned message)
    expect(canSignIn(link(12 * 60, 0), now)).toBe(true); // next morning, browser forgot the session
    expect(canSignIn(link(30 * 24 * 60, 0), now)).toBe(true);
    expect(canSignIn(link((LINK_TTL_DAYS + 1) * 24 * 60, 0), now)).toBe(false); // too old → continue in WhatsApp
    expect(canSignIn(link(5, 1, true), now)).toBe(false); // expired
  });

  it("trusts a device (spend without a code) only on the first open within 30 minutes", () => {
    expect(isFresh(link(10), now)).toBe(true);
    expect(isFresh(link(45), now)).toBe(false);
    expect(opensTrusted(link(10), now)).toBe(true);
    expect(opensTrusted(link(10, 0), now)).toBe(false); // a second open, even a quick one (e.g. forwarded), isn't trusted
    expect(opensTrusted(link(45), now)).toBe(false);
  });
});
