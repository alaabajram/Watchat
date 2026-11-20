import { describe, expect, it } from "vitest";
import { businessPath, isBusinessHost } from "./business-host";

describe("business host routing", () => {
  it("recognises the business subdomain only", () => {
    expect(isBusinessHost("business.watchat.pro")).toBe(true);
    expect(isBusinessHost("Business.watchat.pro:443")).toBe(true);
    expect(isBusinessHost("watchat.pro")).toBe(false);
    expect(isBusinessHost("www.watchat.pro")).toBe(false);
    expect(isBusinessHost("mybusiness.watchat.pro")).toBe(false);
    expect(isBusinessHost(null)).toBe(false);
  });

  it("maps paths into /business", () => {
    expect(businessPath("/")).toBe("/business");
    expect(businessPath("/en")).toBe("/business/en");
    expect(businessPath("/business/en")).toBe("/business/en");
  });
});
