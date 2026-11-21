import { describe, expect, it } from "vitest";
import { canonicalRedirect } from "./canonical";

const site = "https://www.watchat.pro";

describe("sign-in links always sign in on the site address", () => {
  it("stays when already on the site address", () => {
    expect(canonicalRedirect(new URL("https://www.watchat.pro/w/abc"), site)).toBeNull();
  });

  it("moves links opened on another hostname to the site address (same path)", () => {
    expect(canonicalRedirect(new URL("https://watchat-vert.vercel.app/w/abc"), site)).toBe("https://www.watchat.pro/w/abc");
    expect(canonicalRedirect(new URL("https://watchat.pro/w/abc?x=1"), site)).toBe("https://www.watchat.pro/w/abc?x=1");
  });

  it("leaves local development and preview deployments alone", () => {
    expect(canonicalRedirect(new URL("http://localhost:3000/w/abc"), site)).toBeNull();
    expect(canonicalRedirect(new URL("https://watchat-git-some-branch-alaabajrams-projects.vercel.app/w/abc"), site)).toBeNull();
    expect(canonicalRedirect(new URL("https://watchat-a1b2c3d4e-alaabajrams-projects.vercel.app/w/abc"), site)).toBeNull();
  });

  it("ignores a bad site address", () => {
    expect(canonicalRedirect(new URL("https://watchat-vert.vercel.app/w/abc"), "not a url")).toBeNull();
  });
});
