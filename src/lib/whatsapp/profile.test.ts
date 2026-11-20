import { describe, expect, it } from "vitest";
import { websitesWithAccount } from "./profile";

describe("business profile websites", () => {
  it("puts My account first and keeps at most one other site", () => {
    expect(websitesWithAccount([], "https://www.watchat.pro/me")).toEqual(["https://www.watchat.pro/me"]);
    expect(websitesWithAccount(["https://osn.com", "https://x.com"], "https://www.watchat.pro/me")).toEqual(["https://www.watchat.pro/me", "https://osn.com"]);
    expect(websitesWithAccount(["https://www.watchat.pro/me/", "https://osn.com"], "https://www.watchat.pro/me")).toEqual(["https://www.watchat.pro/me", "https://osn.com"]);
  });
});
