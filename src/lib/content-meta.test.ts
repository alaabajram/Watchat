import { describe, expect, it } from "vitest";
import { episodeNumberFromName } from "./content-meta";

describe("episode numbers from file names", () => {
  it("reads the common naming styles", () => {
    expect(episodeNumberFromName("SECRETS01_ep07.mp4")).toBe(7);
    expect(episodeNumberFromName("Secrets E12 final.mov")).toBe(12);
    expect(episodeNumberFromName("Episode 3 - v2.mp4")).toBe(3);
    expect(episodeNumberFromName("حلقة 5.mp4")).toBe(5);
    expect(episodeNumberFromName("الحلقة_10.mp4")).toBe(10);
    expect(episodeNumberFromName("05.mp4")).toBe(5);
    expect(episodeNumberFromName("trailer.mp4")).toBeNull();
  });
});
