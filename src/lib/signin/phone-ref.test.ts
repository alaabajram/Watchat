import { beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  process.env.PHONE_HASH_SECRET = "test-secret-for-phone-hashing-0123456789";
});

describe("sealed phone references", () => {
  it("round-trips, hides the number and refuses tampering or old references", async () => {
    const { openPhone, sealPhone } = await import("./phone-ref");
    const ref = sealPhone("+971501234567");
    expect(ref).not.toContain("971501234567");
    expect(openPhone(ref)).toBe("+971501234567");
    expect(openPhone(ref.slice(0, -2) + (ref.endsWith("A") ? "BB" : "AA"))).toBeNull();
    expect(openPhone("+971501234567")).toBeNull();
    expect(openPhone(42)).toBeNull();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 401 * 86400_000);
    expect(openPhone(ref)).toBeNull();
    vi.useRealTimers();
  });
});
