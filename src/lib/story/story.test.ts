import { describe, expect, it } from "vitest";
import { advance, flagsSetIn, mainPath, reachable, startOf } from "./engine";
import { sanitizeCharacters, sanitizeStory, withUrls } from "./sanitize";
import { blankScene, choiceKey, nextId, type Scene, type StoryGraph } from "./types";
import { hasErrors, validateStory } from "./validate";

const scene = (id: string, patch: Partial<Scene> = {}): Scene => ({ ...blankScene(id, id), text: { ar: "نص", en: "Text" }, ...patch });

// s1 → choice (c1 free → s2, c2 premium 10 Ping sets "brave" → s3) ; s2/s3 → s4 branch on "brave" → s5 (end, named) / s6 (end)
const story: StoryGraph = {
  v: 1,
  start: "s1",
  scenes: [
    scene("s1", {
      route: {
        type: "choices",
        options: [
          { id: "c1", label: { ar: "اهرب", en: "Run" }, to: "s2", price: 0, sets: null },
          { id: "c2", label: { ar: "واجه", en: "Face him" }, to: "s3", price: 10, sets: "brave" },
        ],
      },
    }),
    scene("s2", { route: { type: "next", to: "s4" } }),
    scene("s3", { route: { type: "next", to: "s4" } }),
    scene("s4", { route: { type: "branch", flag: "brave", ifSet: "s5", ifNot: "s6" } }),
    scene("s5", { route: { type: "end", ending: { ar: "النهاية الشجاعة", en: "Brave ending" } } }),
    scene("s6", { route: { type: "end", ending: null } }),
  ],
};

describe("story engine", () => {
  it("starts at the start, or resumes at a saved scene that still exists", () => {
    expect(startOf(story)?.id).toBe("s1");
    expect(startOf(story, "s3")?.id).toBe("s3");
    expect(startOf(story, "gone")?.id).toBe("s1");
  });

  it("waits at a choice until one is picked; premium choices only once paid", () => {
    const s1 = story.scenes[0];
    expect(advance(story, s1, { flags: new Set() }).kind).toBe("wait");
    expect(advance(story, s1, { choiceId: "c2", flags: new Set(), paid: () => false }).kind).toBe("wait");
    const paid = advance(story, s1, { choiceId: "c2", flags: new Set(), paid: () => true });
    expect(paid).toMatchObject({ kind: "scene", setFlag: "brave" });
    expect(paid.kind === "scene" && paid.scene.id).toBe("s3");
    const free = advance(story, s1, { choiceId: "c1", flags: new Set() });
    expect(free.kind === "scene" && free.scene.id).toBe("s2");
  });

  it("routes a branch by an earlier choice", () => {
    const s4 = story.scenes[3];
    const brave = advance(story, s4, { flags: new Set(["brave"]) });
    const plain = advance(story, s4, { flags: new Set() });
    expect(brave.kind === "scene" && brave.scene.id).toBe("s5");
    expect(plain.kind === "scene" && plain.scene.id).toBe("s6");
  });

  it("names endings by their scene, and ends when a route leads nowhere", () => {
    expect(advance(story, story.scenes[4], { flags: new Set() })).toEqual({ kind: "end", ending: "s5", setFlag: null });
    expect(advance(story, story.scenes[5], { flags: new Set() })).toEqual({ kind: "end", ending: null, setFlag: null });
    const g: StoryGraph = { v: 1, start: "a", scenes: [scene("a")] };
    expect(advance(g, g.scenes[0], { flags: new Set() }).kind).toBe("end");
  });

  it("walks the main path along free choices", () => {
    expect(mainPath(story).map((s) => s.id)).toEqual(["s1", "s2", "s4", "s6"]);
    expect(reachable(story).size).toBe(6);
    expect(flagsSetIn([story])).toEqual(["brave"]);
  });

  it("makes ids and purchase keys", () => {
    expect(nextId("s", ["s1", "s2"])).toBe("s3");
    expect(choiceKey("ep", "s1", "c2")).toBe("ep:s1:c2");
  });
});

describe("story checks", () => {
  it("passes a well-formed story", () => {
    expect(hasErrors(validateStory(story, { flagsKnown: ["brave"] }))).toBe(false);
  });

  it("refuses empty episodes, empty scenes, all-paid choices and endless loops", () => {
    expect(hasErrors(validateStory({ v: 1, start: null, scenes: [] }))).toBe(true);
    const empty: StoryGraph = { v: 1, start: "a", scenes: [{ ...blankScene("a"), route: { type: "end", ending: null } }] };
    expect(validateStory(empty).some((i) => i.message.includes("empty"))).toBe(true);
    const paid: StoryGraph = {
      v: 1,
      start: "a",
      scenes: [scene("a", { route: { type: "choices", options: [{ id: "c1", label: { ar: "أ", en: "A" }, to: null, price: 5, sets: null }] } })],
    };
    expect(validateStory(paid).some((i) => i.message.includes("Keep one free choice"))).toBe(true);
    const loop: StoryGraph = { v: 1, start: "a", scenes: [scene("a", { route: { type: "next", to: "b" } }), scene("b", { route: { type: "next", to: "a" } })] };
    expect(validateStory(loop).some((i) => i.message.includes("never ends"))).toBe(true);
  });

  it("warns about unreachable scenes, missing translations and unknown flags", () => {
    const g: StoryGraph = {
      v: 1,
      start: "a",
      scenes: [scene("a", { text: { ar: "نص", en: "" }, route: { type: "branch", flag: "kind", ifSet: null, ifNot: null } }), scene("b")],
    };
    const issues = validateStory(g);
    expect(hasErrors(issues)).toBe(false);
    const all = issues.map((i) => i.message).join("|");
    expect(all).toContain("can't be reached");
    expect(all).toContain("no English text");
    expect(all).toContain('no choice sets "kind"');
  });

  it("flags a speaker that was removed", () => {
    const g: StoryGraph = { v: 1, start: "a", scenes: [scene("a", { speaker: "layla" })] };
    expect(hasErrors(validateStory(g, { characters: [] }))).toBe(true);
  });
});

describe("story sanitize", () => {
  it("drops bad scenes, duplicate ids, unknown targets and junk media", () => {
    const g = sanitizeStory({
      start: "zzz",
      scenes: [
        { id: "a", text: { ar: "x".repeat(900), en: 5 }, route: { type: "next", to: "missing" }, image: { type: "image", path: "../etc/passwd", url: "https://x" } },
        { id: "a" },
        { id: "bad id!" },
        { id: "b", route: { type: "choices", options: [1, { id: "c1", label: { ar: "ن" }, to: "a", price: 9999, sets: "Brave One" }, { id: "c1" }] }, video: { type: "video", path: "r2:CODE/story/v.mp4", url: "javascript:x" } },
      ],
    });
    expect(g.scenes.map((s) => s.id)).toEqual(["a", "b"]);
    expect(g.start).toBe("a");
    expect(g.scenes[0].text.ar.length).toBe(600);
    expect(g.scenes[0].route).toEqual({ type: "next", to: null });
    expect(g.scenes[0].image).toBeNull();
    const r = g.scenes[1].route;
    expect(r.type === "choices" && r.options).toEqual([{ id: "c1", label: { ar: "ن", en: "" }, to: "a", price: 500, sets: null }]);
    expect(g.scenes[1].video).toEqual({ path: "r2:CODE/story/v.mp4", url: "", type: "video" });
  });

  it("rewrites media links from their stored path and removes files outside the series", () => {
    const g = sanitizeStory({ scenes: [{ id: "a", image: { type: "image", path: "cfimg:abc", url: "https://evil" }, audio: { type: "audio", path: "OTHER/x.mp3" } }] });
    const fixed = withUrls(g, (p) => `https://cdn/${p}`, (p) => p.startsWith("cfimg:") || p.startsWith("CODE/story/"));
    expect(fixed.scenes[0].image?.url).toBe("https://cdn/cfimg:abc");
    expect(fixed.scenes[0].audio).toBeNull();
  });

  it("keeps characters tidy with at most one phone owner", () => {
    const c = sanitizeCharacters([
      { id: "layla", name: { ar: "ليلى", en: "Layla" }, color: "#AABBCC", owner: true },
      { id: "omar", name: { ar: "عمر" }, color: "red", owner: true },
      { id: "x", name: {} },
    ]);
    expect(c).toEqual([
      { id: "layla", name: { ar: "ليلى", en: "Layla" }, color: "#aabbcc", avatar: null, owner: true },
      { id: "omar", name: { ar: "عمر", en: "" }, color: "#ff6b5e", avatar: null },
    ]);
  });
});
