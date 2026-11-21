import { describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ db: vi.fn() }));
vi.mock("./env", () => ({ env: { appUrl: "https://watchat.test" } }));

describe("personal link rules — an unknown browser never gets the owner's account", async () => {
  const { decideLinkOpen, FIRST_OPEN_MINUTES, LINK_TTL_DAYS } = await import("./links");
  const now = Date.parse("2026-11-20T12:00:00Z");
  const link = (minutesAgo: number, usesLeft = 1, expired = false) => ({
    viewerId: "owner",
    seriesId: "s1",
    episodeNumber: 4,
    mintedAt: now - minutesAgo * 60_000,
    usesLeft,
    expired,
  });

  it("owner signed in here → open the episode", () => {
    expect(decideLinkOpen(link(600, 0), "owner", "owner", now)).toBe("open");
  });

  it("someone signed in to their own account keeps it (forwarded link → same episode, their account)", () => {
    expect(decideLinkOpen(link(5), "friend", "friend", now)).toBe("open_as_current");
  });

  it("the owner's own browser (session went idle) signs the owner in again, any time before the link expires", () => {
    expect(decideLinkOpen(link(12 * 60, 0), null, "owner", now)).toBe("sign_in_owner");
    expect(decideLinkOpen(link(30 * 24 * 60, 0), null, "owner", now)).toBe("sign_in_owner");
    expect(decideLinkOpen(link((LINK_TTL_DAYS + 1) * 24 * 60, 0), null, "owner", now)).toBe("ask_whatsapp");
  });

  it("a brand-new browser signs in only on the first open, soon after sending (a new viewer's first link)", () => {
    expect(decideLinkOpen(link(5), null, null, now)).toBe("sign_in_first_open");
    expect(decideLinkOpen(link(23 * 60), null, null, now)).toBe("sign_in_first_open"); // opened later the same day
    expect(decideLinkOpen(link(FIRST_OPEN_MINUTES + 5), null, null, now)).toBe("ask_whatsapp"); // late
  });

  it("forwarded / re-opened on an unknown phone, or a browser of another (signed-out) account → Sign in with WhatsApp", () => {
    expect(decideLinkOpen(link(5, 0), null, null, now)).toBe("ask_whatsapp"); // already opened by the owner
    expect(decideLinkOpen(link(600, 0), null, null, now)).toBe("ask_whatsapp"); // pinned link on a new phone
    expect(decideLinkOpen(link(5), null, "friend", now)).toBe("ask_whatsapp"); // browser belongs to someone else
    expect(decideLinkOpen(link(5, 1, true), null, null, now)).toBe("ask_whatsapp"); // expired
  });
});
