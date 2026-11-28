import { describe, expect, it } from "vitest";
import { cleanHref, cleanPath, DEFAULT_HOME, homeLayout, sanitizeHome } from "./home";

describe("home content", () => {
  it("empty content gives the defaults", () => {
    expect(sanitizeHome({})).toEqual(DEFAULT_HOME);
    expect(sanitizeHome(null).headline.en).toBe("Something interesting is");
  });

  it("keeps edits, fills blanks with the default per language", () => {
    const c = sanitizeHome({ headline: { ar: "مرحبا", en: "" }, kicker: { ar: "x".repeat(500), en: "Lobby" } });
    expect(c.headline).toEqual({ ar: "مرحبا", en: DEFAULT_HOME.headline.en });
    expect(c.kicker.ar).toHaveLength(60);
  });

  it("only accepts picture paths we made", () => {
    expect(cleanPath("cfimg:0f8e6a5c-1234-4bcd-9abc-1234567890ab")).toBeTruthy();
    expect(cleanPath("r2:play/t/1.png")).toBe("r2:play/t/1.png");
    expect(cleanPath("play/t/1.png")).toBe("play/t/1.png");
    expect(cleanPath("https://evil.example/x.png")).toBeNull();
    expect(cleanPath("../secrets")).toBeNull();
  });

  it("links: our pages or https only", () => {
    expect(cleanHref("/rooms/debate")).toBe("/rooms/debate");
    expect(cleanHref("https://example.com/a")).toBe("https://example.com/a");
    expect(cleanHref("javascript:alert(1)")).toBe("/");
    expect(cleanHref("//evil.com")).toBe("/");
  });

  it("caps Discover tiles at six and keeps an explicit empty list", () => {
    expect(sanitizeHome({ discover: { tiles: Array.from({ length: 9 }, () => ({ title: { ar: "أ", en: "A" } })) } }).discover.tiles).toHaveLength(6);
    expect(sanitizeHome({ discover: { tiles: [] } }).discover.tiles).toHaveLength(0);
  });

  it("lays out rooms: marked hero, else the first tile; hidden rooms skipped", () => {
    const rooms = [
      { id: "a", homeSlot: "tile" as const },
      { id: "b", homeSlot: "wide" as const },
      { id: "c", homeSlot: "hidden" as const },
      { id: "d", homeSlot: "tile" as const },
    ];
    const l = homeLayout(rooms);
    expect(l.hero?.id).toBe("a");
    expect(l.tiles.map((r) => r.id)).toEqual(["d"]);
    expect(l.wide.map((r) => r.id)).toEqual(["b"]);
    expect(homeLayout([...rooms, { id: "e", homeSlot: "hero" as const }]).hero?.id).toBe("e");
  });
});
