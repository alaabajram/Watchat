import { describe, expect, it } from "vitest";
import { sanitizeBible, mergeBible, setupStatus, voicedCharacters } from "./bible";
import { audioRates, checkBudget, estimateCredits, modelKey } from "./budget";
import { handleRpc, ToolError, type Tool } from "./mcp";
import { addNote, afterSubmit, canMove, claudeMay, closeNotes, openNotes, teamMoves } from "./stages";

describe("studio stages", () => {
  it("lets Claude write only before review and make pictures only after the script is approved", () => {
    expect(claudeMay.writeScript("brief")).toBe(true);
    expect(claudeMay.writeScript("script_review")).toBe(false);
    expect(claudeMay.attachMedia("writing")).toBe(false);
    expect(claudeMay.attachMedia("pictures")).toBe(true);
    expect(afterSubmit("writing")).toBe("script_review");
    expect(afterSubmit("pictures")).toBe("final_check");
    expect(afterSubmit("final_check")).toBeNull();
  });

  it("gives the team approve / send back moves", () => {
    expect(teamMoves("script_review").map((m) => m.to)).toEqual(["pictures", "writing"]);
    expect(canMove("final_check", "approved")).toBe(true);
    expect(canMove("brief", "published")).toBe(false);
    expect(teamMoves("published")).toEqual([]);
  });

  it("keeps a note thread; team notes stay open until Claude submits again", () => {
    let n = addNote([], { by: "Alaa", who: "team", text: "  Make Nasser funnier ", stage: "script_review" });
    n = addNote(n, { by: "Claude", who: "claude", text: "Done", stage: "writing" });
    n = addNote(n, { by: "x", who: "team", text: "   ", stage: "writing" });
    expect(n).toHaveLength(2);
    expect(openNotes(n).map((x) => x.text)).toEqual(["Make Nasser funnier"]);
    expect(openNotes(closeNotes(n))).toEqual([]);
  });
});

describe("studio credit budget", () => {
  it("estimates from OpenArt rates and never below what Claude claims", () => {
    expect(modelKey("Nano Banana Pro")).toBe("nano-banana-pro");
    expect(modelKey("Kling 3.0")).toBe("kling-3");
    expect(estimateCredits({ model: "nano banana pro", kind: "image", count: 3 })).toEqual({ credits: 120, model: "nano-banana-pro" });
    expect(estimateCredits({ model: "nano-banana-pro", kind: "image", count: 1, credits: 80 })).toEqual({ credits: 80, model: "nano-banana-pro" });
    expect(estimateCredits({ model: "kling-3", kind: "video", count: 1, seconds: 15 })).toEqual({ credits: 525, model: "kling-3" });
    expect(estimateCredits({ model: "kling-3", kind: "video", count: 1 })).toHaveProperty("error");
    expect(estimateCredits({ model: "mystery", kind: "image", count: 1 })).toHaveProperty("error");
    expect(estimateCredits({ model: "mystery", kind: "image", count: 1, credits: 15 })).toEqual({ credits: 15, model: "mystery" });
    expect(estimateCredits({ model: "nano-banana-2", kind: "image", count: 50 })).toHaveProperty("error");
    expect(estimateCredits({ model: "nano-banana-2", kind: "video", count: 1, seconds: 5 })).toHaveProperty("error");
  });

  it("refuses past the monthly allowance or the episode cap", () => {
    const b = { monthly: 24000, monthUsed: 23900, episodeCap: 2500, episodeUsed: 0 };
    expect(checkBudget(b, 80)).toMatchObject({ ok: true, monthLeft: 20 });
    expect(checkBudget(b, 200)).toMatchObject({ ok: false });
    expect(checkBudget({ ...b, monthUsed: 0, episodeUsed: 2450 }, 80)).toMatchObject({ ok: false, episodeLeft: 50 });
  });
});

describe("series bible", () => {
  it("cleans input and locks characters once approved", () => {
    const b = sanitizeBible({ style: " photoreal ", rules: "Gulf dialect\n\nNo swearing", characters: [{ id: "Amal", look: "29, olive skin", portrait: "javascript:x" }, { id: "amal" }], locked: false });
    expect(b).toEqual({ style: "photoreal", dialect: "", rules: ["Gulf dialect", "No swearing"], characters: [{ id: "amal", look: "29, olive skin", portrait: null, voice: "", voiceSample: null }], theme: { desc: "", url: null }, locked: false, brief: "", planned: 0, outline: [] });
    const merged = mergeBible(b, { characters: [{ id: "amal", look: "29, olive skin, wavy hair", portrait: "https://img/amal.png" }] });
    expect(merged.bible.characters[0]).toEqual({ id: "amal", look: "29, olive skin, wavy hair", portrait: "https://img/amal.png", voice: "", voiceSample: null });
    const locked = mergeBible({ ...merged.bible, locked: true }, { characters: [{ id: "amal", look: "different", portrait: null }], style: "cartoon" });
    expect(locked.refused).toHaveLength(2);
    expect(locked.bible.characters[0].look).toBe("29, olive skin, wavy hair");
  });
});

describe("connector protocol", () => {
  const tools: Tool<{ who: string }>[] = [
    { name: "hello", title: "Hello", description: "says hi", inputSchema: { type: "object", properties: {} }, readOnly: true, run: async (_a, ctx) => ({ hi: ctx.who }) },
    {
      name: "boom",
      title: "Boom",
      description: "fails",
      inputSchema: { type: "object", properties: {} },
      run: async () => {
        throw new ToolError("Not allowed at this stage.");
      },
    },
  ];
  const server = { name: "watchat", version: "1", instructions: "Be brief.", tools };

  it("initializes with a supported version and lists tools", async () => {
    const init = (await handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } }, server, { who: "a" })) as { result: { protocolVersion: string; instructions: string } };
    expect(init.result.protocolVersion).toBe("2025-03-26");
    expect(init.result.instructions).toBe("Be brief.");
    const list = (await handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, server, { who: "a" })) as { result: { tools: { name: string; annotations: { readOnlyHint: boolean } }[] } };
    expect(list.result.tools.map((t) => [t.name, t.annotations.readOnlyHint])).toEqual([
      ["hello", true],
      ["boom", false],
    ]);
  });

  it("calls tools, returns tool errors as results, ignores notifications", async () => {
    expect(await handleRpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "hello", arguments: {} } }, server, { who: "Alaa" })).toEqual({
      jsonrpc: "2.0",
      id: 3,
      result: { content: [{ type: "text", text: '{"hi":"Alaa"}' }] },
    });
    const err = (await handleRpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "boom" } }, server, { who: "a" })) as { result: { isError: boolean; content: { text: string }[] } };
    expect(err.result.isError).toBe(true);
    expect(err.result.content[0].text).toBe("Not allowed at this stage.");
    expect(await handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, server, { who: "a" })).toBeNull();
    expect(await handleRpc({ jsonrpc: "2.0", id: 5, method: "nope" }, server, { who: "a" })).toMatchObject({ error: { code: -32601 } });
    expect(await handleRpc({ id: 6, method: "ping" }, server, { who: "a" })).toMatchObject({ error: { code: -32600 } });
  });
});

describe("connector key from headers", async () => {
  const { keyFromHeaders, keyCandidates } = await import("./connector");
  it("tries header keys first, then the address key, without duplicates", () => {
    expect(keyCandidates(new Headers({ "x-api-key": "old" }), "new")).toEqual(["old", "new"]);
    expect(keyCandidates(new Headers({ "x-api-key": "same" }), "same")).toEqual(["same"]);
    expect(keyCandidates(new Headers(), null)).toEqual([]);
  });
  it("reads Authorization: Bearer or X-Watchat-Key", () => {
    expect(keyFromHeaders(new Headers({ Authorization: "Bearer abc123" }))).toBe("abc123");
    expect(keyFromHeaders(new Headers({ authorization: "bearer  xyz " }))).toBe("xyz");
    expect(keyFromHeaders(new Headers({ "X-Watchat-Key": "k1" }))).toBe("k1");
    expect(keyFromHeaders(new Headers({ "x-api-key": "k2" }))).toBe("k2");
    expect(keyFromHeaders(new Headers({ "x-api-key": "Bearer k3" }))).toBe("k3");
    expect(keyFromHeaders(new Headers({ Authorization: "Basic zzz" }))).toBeNull();
    expect(keyFromHeaders(new Headers())).toBeNull();
  });
});

describe("series setup", () => {
  it("keeps the team's brief, takes Claude's outline, and reports the setup status", () => {
    const start = sanitizeBible({ brief: "Two colleagues, wrong tickets", planned: 4 });
    expect(setupStatus(start)).toBe("needs_claude");
    const outline = sanitizeBible({ outline: [{ number: 2, title_en: "Not the plan", brief: "Hanoi" }, { number: 1, title: { ar: "آخر يوم", en: "Last day" }, brief: "Office" }, { number: 1 }] }).outline;
    expect(outline.map((o) => o.number)).toEqual([1, 2]);
    expect(outline[1].title.en).toBe("Not the plan");
    const merged = mergeBible(start, { style: "photoreal", characters: [{ id: "amal", look: "29", portrait: null }], outline }).bible;
    expect(merged.brief).toBe("Two colleagues, wrong tickets");
    expect(merged.planned).toBe(4);
    expect(setupStatus(merged)).toBe("to_review");
    expect(setupStatus({ ...merged, locked: true })).toBe("locked");
    expect(mergeBible({ ...merged, locked: true }, { outline }).refused).toHaveLength(1);
  });
});

describe("studio sound", () => {
  it("estimates sound by kind and seconds, never below what Claude claims, with the team's rates", () => {
    expect(estimateCredits({ model: "", kind: "audio", audioKind: "voice", count: 3, seconds: 5 })).toEqual({ credits: 30, model: "voice" });
    expect(estimateCredits({ model: "x", kind: "audio", audioKind: "music", count: 1, seconds: 60, credits: 500 })).toMatchObject({ credits: 500 });
    expect(estimateCredits({ model: "x", kind: "audio", audioKind: "music", count: 1, seconds: 60 }, audioRates({ music: 10 }))).toMatchObject({ credits: 600 });
    expect(estimateCredits({ model: "x", kind: "audio", count: 1, seconds: 5 })).toHaveProperty("error");
    expect(estimateCredits({ model: "x", kind: "audio", audioKind: "sfx", count: 1, seconds: 40 })).toHaveProperty("error");
    expect(audioRates({ voice: -3, sfx: "7" })).toMatchObject({ voice: 2, sfx: 7 });
  });

  it("keeps the theme and locked voices in the bible; only voiced characters with a sample may speak", () => {
    const b = sanitizeBible({
      theme: { desc: "oud", url: "https://cdn.example/t.mp3" },
      characters: [
        { id: "karim", look: "x", voice: "warm baritone, 30s, Gulf", voice_sample: "https://cdn.example/k.mp3" },
        { id: "warda", look: "y", voice: "" },
        { id: "sami", look: "z", voice: "boyish" },
      ],
    });
    expect(b.theme).toEqual({ desc: "oud", url: "https://cdn.example/t.mp3" });
    expect(voicedCharacters(b)).toEqual(["karim"]);
    const merged = mergeBible(b, { characters: [{ id: "sami", voiceSample: "https://cdn.example/s.mp3" }], theme: { desc: "oud and strings" } }).bible;
    expect(merged.characters.find((c) => c.id === "sami")).toMatchObject({ look: "z", voice: "boyish", voiceSample: "https://cdn.example/s.mp3" });
    expect(merged.theme).toEqual({ desc: "oud and strings", url: "https://cdn.example/t.mp3" });
    const locked = mergeBible({ ...b, locked: true }, { theme: { desc: "new" } });
    expect(locked.refused.join()).toMatch(/theme/);
    expect(locked.bible.theme.desc).toBe("oud");
  });
});
