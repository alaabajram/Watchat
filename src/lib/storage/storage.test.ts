import { describe, expect, it } from "vitest";
import { extOf, findSupabaseMediaUrls, imageUrl, isImageExt, providerOf, r2Url, supabaseMediaPath } from "./refs";

const SB = "https://onllrmoysncxdmbznmqk.supabase.co/storage/v1/object/public/media/TEST02/artwork-1-ab12.png";

describe("storage refs", () => {
  it("knows which provider holds a saved path", () => {
    expect(providerOf("cfimg:2cdc28f0-017a-49c4-9ed7-87056c83901")).toBe("images");
    expect(providerOf("r2:TEST02/clip-1.mp4")).toBe("r2");
    expect(providerOf("TEST02/clip-1.mp4")).toBe("supabase");
  });
  it("builds public links", () => {
    expect(imageUrl("HASH", "abc")).toBe("https://imagedelivery.net/HASH/abc/watchat");
    expect(r2Url("https://media.watchat.pro/", "TEST02/clip 1.mp4")).toBe("https://media.watchat.pro/TEST02/clip%201.mp4");
  });
  it("reads Supabase media links", () => {
    expect(supabaseMediaPath(SB)).toBe("TEST02/artwork-1-ab12.png");
    expect(supabaseMediaPath("https://imagedelivery.net/x/y/watchat")).toBeNull();
    const blob = JSON.stringify({ nodes: [{ media: { url: SB } }, { media: { url: SB } }, { url: "https://x.supabase.co/storage/v1/object/public/media/a/b.mp4" }] });
    expect(findSupabaseMediaUrls(blob)).toEqual([SB, "https://x.supabase.co/storage/v1/object/public/media/a/b.mp4"]);
  });
  it("sends pictures to Images and the rest to R2", () => {
    expect(isImageExt(extOf(SB))).toBe(true);
    expect(isImageExt(extOf("a/b.mp4"))).toBe(false);
    expect(isImageExt(extOf("a/b.vtt"))).toBe(false);
  });
});
