import { describe, expect, it } from "vitest";
import { brandCss, cleanSiteUrl, contrast, inkOn, parsePage, readableOn } from "./brand";

describe("brand settings", () => {
  it("accepts site addresses and rejects anything unsafe", () => {
    expect(cleanSiteUrl("www.watchat.pro/")).toBe("https://www.watchat.pro");
    expect(cleanSiteUrl("https://label.example.com/path?x=1")).toBe("https://label.example.com");
    expect(cleanSiteUrl("http://watchat.pro")).toBeNull();
    expect(cleanSiteUrl("http://localhost:3000")).toBe("http://localhost:3000");
    expect(cleanSiteUrl("javascript:alert(1)")).toBeNull();
    expect(cleanSiteUrl("intranet")).toBeNull();
  });

  it("derives readable text colours from any brand colour", () => {
    expect(contrast(readableOn("#31e5a0"), "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(inkOn("#31e5a0")).not.toBe("#ffffff"); // mint takes dark text
    expect(inkOn("#1d4ed8")).toBe("#ffffff"); // deep blue takes white text
    expect(brandCss({ colorPrimary: "#1d4ed8", colorAccent: "nope" })).toContain("--a-coral:#ff5a48");
  });

  it("formats pages safely", () => {
    const b = parsePage("# Title\n\nHello **there**, see [privacy](/privacy).\n- one\n- [bad](javascript:x)\n\n## Next\n<script>x</script>");
    expect(b.map((x) => x.type)).toEqual(["h1", "p", "ul", "h2", "p"]);
    expect(b[1].parts[0]).toEqual([{ text: "Hello " }, { text: "there", bold: true }, { text: ", see " }, { text: "privacy", href: "/privacy" }, { text: "." }]);
    expect(b[2].parts[1]).toEqual([{ text: "bad" }]); // unsafe link dropped, text kept
    expect(b[4].parts[0][0].text).toBe("<script>x</script>"); // rendered as text, never HTML
  });
});
