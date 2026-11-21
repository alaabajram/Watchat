import { describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ db: vi.fn() }));
vi.mock("./env", () => ({ env: { appUrl: "https://watchat.test" } }));

describe("personal link rules", async () => {
  const { canSignIn, decideLinkOpen, LINK_TTL_DAYS } = await import("./links");
  const now = Date.parse("2026-11-20T12:00:00Z");
  const link = (minutesAgo: number, usesLeft = 1, expired = false) => ({
    viewerId: "owner",
    seriesId: "s1",
    episodeNumber: 4,
    mintedAt: now - minutesAgo * 60_000,
    usesLeft,
    expired,
  });

  it("links from the Watchat chat always sign their owner in until they expire", () => {
    expect(canSignIn(link(5), now)).toBe(true);
    expect(canSignIn(link(5, 0), now)).toBe(true); // re-opened (pinned message)
    expect(canSignIn(link(12 * 60, 0), now)).toBe(true); // next morning, browser forgot the session
    expect(canSignIn(link((LINK_TTL_DAYS + 1) * 24 * 60, 0), now)).toBe(false);
    expect(canSignIn(link(5, 1, true), now)).toBe(false);
  });

  it("owner already signed in → open the episode", () => {
    expect(decideLinkOpen(link(5, 0), "owner", now)).toBe("open");
  });

  it("someone signed in to their own account keeps it (forwarded link → same episode, their account)", () => {
    expect(decideLinkOpen(link(5, 0), "friend", now)).toBe("open_as_current");
    expect(decideLinkOpen(link(5, 1, true), "friend", now)).toBe("open_as_current");
  });

  it("no sign-in on this browser → sign the owner in, every time; expired → continue in WhatsApp", () => {
    expect(decideLinkOpen(link(5), null, now)).toBe("sign_in_owner");
    expect(decideLinkOpen(link(600, 0), null, now)).toBe("sign_in_owner");
    expect(decideLinkOpen(link(5, 1, true), null, now)).toBe("expired");
  });
});
