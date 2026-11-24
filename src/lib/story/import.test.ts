import { describe, expect, it } from "vitest";
import { applyMedia, applyPicture, extractJson, hostAllowed, mediaKindOf, parseMediaList, parseStoryImport, pictureRefs, refFromFileName } from "./import";

const reply = `Here is your story!

8. JSON FOR IMPORT
\`\`\`json
{
  "characters": [{"id": "Amal", "name": {"ar": "أمل", "en": "Amal"}, "color": "#E78A55"}],
  "episodes": [{
    "number": 1,
    "title": {"ar": "آخر يوم دوام", "en": "The Last Day"},
    "story": {"v": 1, "start": "s1", "scenes": [
      {"id": "s1", "name": "Office", "image_ref": "img_01", "speaker": "amal", "text": {"ar": "أخيراً!", "en": "Finally!"}, "motion": "zoom_in", "auto": 0,
       "route": {"type": "choices", "options": [
         {"id": "c1", "label": {"ar": "أساعده", "en": "Help"}, "to": "s2", "price": 0, "sets": ["helped_nasser", "chose_adventure"]},
         {"id": "c2", "label": {"ar": "سر", "en": "Secret"}, "to": "s2", "price": 15, "sets": "shared_secret"}]}},
      {"id": "s2", "image_ref": "IMG_01", "speaker": "narrator", "text": {"ar": "النهاية", "en": "The end"}, "route": {"type": "end", "ending": null}},
      {"id": "s3", "image_ref": "img_02", "speaker": "ghost", "text": {"ar": "؟", "en": "?"}, "route": {"type": "next", "to": null}}
    ]}
  }]
}
\`\`\`
Production notes...`;

describe("story import", () => {
  it("finds the JSON inside a pasted reply", () => {
    expect(extractJson('blah {"a": 1} blah')).toEqual({ a: 1 });
    expect(() => extractJson("no json here")).toThrow(/No story JSON/);
  });

  it("reads characters, episodes, picture names and fixes writer quirks", () => {
    const r = parseStoryImport(reply);
    expect(r.characters.map((c) => c.id)).toEqual(["amal"]);
    expect(r.episodes).toHaveLength(1);
    const [s1, s2, s3] = r.episodes[0].story.scenes;
    expect(s1.ref).toBe("img_01");
    expect(s1.speaker).toBe("amal");
    expect(s2.ref).toBe("img_01");
    expect(s2.speaker).toBeNull();
    expect(s3.speaker).toBeNull();
    const route = s1.route;
    expect(route.type === "choices" && route.options.map((c) => c.sets)).toEqual(["helped_nasser", "shared_secret"]);
    expect(r.notes.join("|")).toContain("only \"helped_nasser\" is kept");
    expect(r.notes.join("|")).toContain('speaker "ghost"');
  });

  it("lists pictures to make and puts an upload on every matching scene", () => {
    const g = parseStoryImport(reply).episodes[0].story;
    expect(pictureRefs([g])).toEqual([
      { ref: "img_01", scenes: 2, missing: 2 },
      { ref: "img_02", scenes: 1, missing: 1 },
    ]);
    const { story, count } = applyPicture(g, refFromFileName("IMG_01 (1).JPG"), { path: "cfimg:x", url: "https://i/x", type: "image" });
    expect(count).toBe(2);
    expect(pictureRefs([story])[0]).toEqual({ ref: "img_01", scenes: 2, missing: 0 });
  });

  it("refuses text without episodes", () => {
    expect(() => parseStoryImport('{"characters": []}')).toThrow(/no episodes/);
  });
});

describe("story import media", () => {
  it("reads the media list as an object or an array, https only", () => {
    const notes: string[] = [];
    expect(parseMediaList({ IMG_01: "https://cdn.openart.ai/a.png", img_02: "http://x/b.png", "bad ref!": "https://x" }, notes)).toEqual([{ ref: "img_01", url: "https://cdn.openart.ai/a.png" }]);
    expect(notes[0]).toContain("img_02");
    expect(parseMediaList([{ ref: "img_03", url: "https://openart.ai/v.mp4" }])).toEqual([{ ref: "img_03", url: "https://openart.ai/v.mp4" }]);
    const withMedia = reply.replace('"characters"', '"media": {"img_01": "https://cdn.openart.ai/x.jpg"}, "characters"');
    expect(parseStoryImport(withMedia).media).toHaveLength(1);
  });

  it("only allows listed hosts and their subdomains", () => {
    expect(hostAllowed("https://cdn.openart.ai/x.png", ["openart.ai"])).toBe(true);
    expect(hostAllowed("https://openart.ai/x.png", ["openart.ai"])).toBe(true);
    expect(hostAllowed("https://evilopenart.ai/x.png", ["openart.ai"])).toBe(false);
    expect(hostAllowed("http://cdn.openart.ai/x.png", ["openart.ai"])).toBe(false);
    expect(hostAllowed("not a url", ["openart.ai"])).toBe(false);
  });

  it("tells pictures from clips", () => {
    expect(mediaKindOf("https://a/b/c.JPEG?sig=1")).toEqual({ type: "image", ext: "jpg" });
    expect(mediaKindOf("https://a/clip.mp4")).toEqual({ type: "video", ext: "mp4" });
    expect(mediaKindOf("https://a/file", "image/webp; q=1")).toEqual({ type: "image", ext: "webp" });
    expect(mediaKindOf("https://a/file.gif")).toBeNull();
  });

  it("puts clips in the scene's video slot", () => {
    const g = parseStoryImport(reply).episodes[0].story;
    const r = applyMedia(g, "img_02", { path: "r2:X/story/c.mp4", url: "https://r2/c.mp4", type: "video" });
    expect(r.count).toBe(1);
    expect(r.story.scenes[2].video?.type).toBe("video");
    expect(r.story.scenes[2].image).toBeNull();
    expect(applyMedia(g, "img_01", { path: "cfimg:x", url: "https://i/x", type: "image" }).count).toBe(2);
  });
});
