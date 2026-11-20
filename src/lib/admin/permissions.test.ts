import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

describe("admin roles", () => {
  it("limits each role to its areas", async () => {
    const { can } = await import("./auth");
    const as = (role: "owner" | "content" | "marketing" | "support" | "finance") =>
      ({ id: "a", tenantId: "t", email: "x", name: null, role, mustChangePassword: false }) as const;
    expect(can(as("owner"), "team")).toBe(true);
    expect(can(as("content"), "content")).toBe(true);
    expect(can(as("content"), "messaging")).toBe(false);
    expect(can(as("marketing"), "messaging")).toBe(true);
    expect(can(as("marketing"), "grantCoins")).toBe(false);
    expect(can(as("support"), "grantCoins")).toBe(true);
    expect(can(as("support"), "pricing")).toBe(false);
    expect(can(as("finance"), "pricing")).toBe(true);
    expect(can(as("finance"), "team")).toBe(false);
    expect(can(as("finance"), "orders")).toBe(true);
    expect(can(as("marketing"), "orders")).toBe(false);
  });
});
