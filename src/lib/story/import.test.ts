import { describe, expect, it } from "vitest";
import { applyPicture, extractJson, parseStoryImport, pictureRefs, refFromFileName } from "./import";

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
