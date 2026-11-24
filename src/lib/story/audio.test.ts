import { describe, expect, it } from "vitest";
import { audioPlan, mediaMissing, musicOf } from "./engine";
import { applyAudio, applyMedia, clearAudio, keepMade, mediaKindOf, parseStoryImport } from "./import";
import { mediaOfStory, sanitizeStory, withUrls } from "./sanitize";
import type { StoryMedia } from "./types";
import { validateStory } from "./validate";

const snd = (n: string): StoryMedia => ({ path: `r2:X/story/${n}.mp3`, url: `https://cdn.example/${n}.mp3`, type: "audio", name: n });

// What Claude saves through watchat_save_episode_script.
const script = {
  start: "s1",
  music: [{ id: "mus_01", desc: "oud, slow", mood: "warm" }],
  scenes: [
    { id: "s1", text: { ar: "الليل", en: "Night" }, image_ref: "img_01", audio: { music: "mus_01", sfx: [{ id: "sfx_01", desc: "door creak" }] }, route: { type: "next", to: "s2" } },
    { id: "s2", speaker: "karim", text: { ar: "مين؟", en: "Who's there?" }, audio: { voice: { id: "vo_s02" }, sfx: ["sfx_01", "sfx_02"] }, route: { type: "next", to: "s3" } },
    { id: "s3", text: { ar: "صمت", en: "Silence" }, audio: { music: "stop" }, route: { type: "end", ending: null } },
  ],
};

describe("story sound cues", () => {
  const g = sanitizeStory(script);

  it("reads the cue form into beds, music starts/stops, effects and voice lines", () => {
    expect(g.music).toEqual([{ id: "mus_01", desc: "oud, slow", mood: "warm", media: null }]);
    expect(g.scenes[0]).toMatchObject({ musicRef: "mus_01", sfx: [{ id: "sfx_01", desc: "door creak", media: null }], audio: null });
    expect(g.scenes[1]).toMatchObject({ voiceRef: "vo_s02", sfx: [{ id: "sfx_01" }, { id: "sfx_02" }] });
    expect(g.scenes[2].stopMusic).toBe(true);
    // Wrong prefixes are dropped rather than trusted.
    expect(sanitizeStory({ scenes: [{ id: "a", audio: { music: "sfx_01", voice: "mus_01" } }] }).scenes[0]).not.toHaveProperty("musicRef");
  });

  it("plans every sound and lists what is missing", () => {
    expect(audioPlan(g).map((a) => [a.ref, a.kind, a.scenes])).toEqual([
      ["mus_01", "music", ["s1"]],
      ["sfx_01", "sfx", ["s1", "s2"]],
      ["sfx_02", "sfx", ["s2"]],
      ["vo_s02", "voice", ["s2"]],
    ]);
    expect(mediaMissing(g).audio).toEqual(["mus_01", "sfx_01", "sfx_02", "vo_s02"]);
  });

  it("attaches files by name, plays the bed through musicOf, and can take one off again", () => {
    let s = applyAudio(g, "mus_01", snd("m")).story;
    expect(musicOf(s, s.scenes[0])?.url).toBe("https://cdn.example/m.mp3");
    const fx = applyMedia(s, "sfx_01", snd("fx"));
    expect(fx.count).toBe(2);
    s = applyMedia(fx.story, "sfx_02", snd("fx2")).story;
    s = applyMedia(s, "vo_s02", snd("v")).story;
    expect(s.scenes[1].audio?.url).toBe("https://cdn.example/v.mp3");
    expect(mediaMissing(s).audio).toEqual([]);
    expect(applyAudio(g, "mus_09", snd("x")).count).toBe(0);
    expect(mediaOfStory(s)).toHaveLength(5);

    const redo = clearAudio(s, "sfx_01");
    expect(redo.count).toBe(2);
    expect(mediaMissing(redo.story).audio).toEqual(["sfx_01"]);
  });

  it("keeps made sounds when the script is rewritten with the same names", () => {
    const made = applyMedia(applyMedia(applyAudio(g, "mus_01", snd("m")).story, "sfx_01", snd("fx")).story, "vo_s02", snd("v")).story;
    const rewritten = keepMade(sanitizeStory(script), made);
    expect(rewritten.music?.[0].media?.url).toBe("https://cdn.example/m.mp3");
    expect(rewritten.scenes[1].audio?.url).toBe("https://cdn.example/v.mp3");
    expect(rewritten.scenes[1].sfx?.[0].media?.url).toBe("https://cdn.example/fx.mp3");
  });

  it("rebuilds sound links from stored paths only", () => {
    const s = applyAudio(g, "mus_01", { ...snd("m"), url: "https://evil.example/m.mp3" }).story;
    const fixed = withUrls(s, (p) => `https://cdn.ours/${p}`, (p) => p.startsWith("r2:"));
    expect(fixed.music?.[0].media?.url).toBe("https://cdn.ours/r2:X/story/m.mp3");
  });

  it("recognises sound files", () => {
    expect(mediaKindOf("https://cdn.openart.ai/a/b.mp3")).toEqual({ type: "audio", ext: "mp3" });
    expect(mediaKindOf("https://x/y", "audio/x-wav")).toEqual({ type: "audio", ext: "wav" });
    expect(mediaKindOf("https://x/y.m4a?sig=1")).toEqual({ type: "audio", ext: "m4a" });
  });

  it("imports scripts with sound cues", () => {
    const im = parseStoryImport(JSON.stringify({ characters: [{ id: "karim", name: { en: "Karim" } }], episodes: [{ number: 1, story: script }] }));
    expect(im.episodes[0].story.scenes[1].voiceRef).toBe("vo_s02");
    expect(im.episodes[0].story.music).toHaveLength(1);
  });
});

describe("sound checks", () => {
  const chars = [{ id: "karim", name: { ar: "كريم", en: "Karim" }, color: "#ff0000", avatar: null }];
  const msgs = (raw: unknown, voices?: string[]) => validateStory(sanitizeStory(raw), { characters: chars, voices }).filter((i) => i.level === "error").map((i) => i.message);

  it("passes a good script", () => {
    expect(msgs(script, ["karim"])).toEqual([]);
  });

  it("refuses voice lines on narrator scenes, unvoiced characters and empty text", () => {
    expect(msgs({ scenes: [{ id: "s1", text: { en: "x" }, voiceRef: "vo_s1", route: { type: "end" } }] }).join()).toMatch(/no speaker/);
    expect(msgs(script, []).join()).toMatch(/no locked voice/);
    expect(msgs({ scenes: [{ id: "s1", speaker: "karim", image: null, voiceRef: "vo_s1", route: { type: "end" } }] }, ["karim"]).join()).toMatch(/no text/);
  });

  it("refuses unknown beds, more than 2 beds and more than 2 effects", () => {
    expect(msgs({ scenes: [{ id: "s1", text: { en: "x" }, musicRef: "mus_07", route: { type: "end" } }] }).join()).toMatch(/no music bed/);
    expect(msgs({ music: [{ id: "mus_01" }, { id: "mus_02" }, { id: "mus_03" }], scenes: [{ id: "s1", text: { en: "x" }, route: { type: "end" } }] }).join()).toMatch(/At most 2 music beds/);
    expect(msgs({ scenes: [{ id: "s1", text: { en: "x" }, sfx: ["sfx_1", "sfx_2", "sfx_3"], route: { type: "end" } }] }).join()).toMatch(/3 sound effects/);
  });
});
