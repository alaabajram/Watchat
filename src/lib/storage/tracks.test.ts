import { describe, expect, it } from "vitest";
import { whatsappArgs } from "@/components/admin/compress";
import { classifyFile, pendingTracks, playbackLangs, srtToVtt } from "./tracks";

describe("dropped files", () => {
  it("tells videos, subtitles and dubs apart, with episode and language", () => {
    expect(classifyFile("ep07.mp4", "video/mp4")).toEqual({ kind: "video", number: 7, lang: "en" });
    expect(classifyFile("ep07.en.srt")).toEqual({ kind: "sub", number: 7, lang: "en" });
    expect(classifyFile("EP12_English.mp3", "audio/mpeg")).toEqual({ kind: "audio", number: 12, lang: "en" });
    expect(classifyFile("ep3.ar.vtt")).toMatchObject({ kind: "sub", number: 3, lang: "ar" });
    expect(classifyFile("حلقة 5 عربي.vtt")).toMatchObject({ kind: "sub", number: 5, lang: "ar" });
    expect(classifyFile("Green Garden ep 4.vtt")).toMatchObject({ number: 4, lang: "en" });
    expect(classifyFile("notes.pdf").kind).toBeNull();
  });
});

describe("subtitles", () => {
  it("turns SubRip into WebVTT", () => {
    const vtt = srtToVtt("﻿1\r\n00:00:01,500 --> 00:00:03,000\r\nWhere were you?\r\n");
    expect(vtt).toBe("WEBVTT\n\n1\n00:00:01.500 --> 00:00:03.000\nWhere were you?\n");
  });
});

describe("what the player turns on", () => {
  const dub = { audio: { en: { url: "u", path: "p", stream: "attached" as const } } };
  it("plays the English dub for English viewers when there is one", () => {
    expect(playbackLangs("ar_en_subs", dub)).toEqual({ audio: "en", subs: null });
  });
  it("falls back to English subtitles, and leaves Arabic viewers alone", () => {
    expect(playbackLangs("ar_en_subs", {})).toEqual({ audio: null, subs: "en" });
    expect(playbackLangs("ar_en_subs", { audio: { en: { url: "u", path: "p", stream: "pending" } } })).toEqual({ audio: null, subs: "en" });
    expect(playbackLangs("ar", dub)).toEqual({ audio: null, subs: null });
  });
  it("lists tracks still waiting for the video", () => {
    expect(pendingTracks({ subs: { en: { url: "u", path: "p", stream: "pending" }, ar: { url: "u", path: "p", stream: "attached" } } }).map((t) => t.lang)).toEqual(["en"]);
  });
});

describe("English chat version (ffmpeg)", () => {
  it("uses the dub as the sound and burns in subtitles when asked", () => {
    const dub = whatsappArgs(700, { audio: true, subtitles: false });
    expect(dub.join(" ")).toContain("-i aud -map 0:v:0 -map 1:a:0");
    const subs = whatsappArgs(700, { audio: false, subtitles: true }).join(" ");
    expect(subs).toContain("subtitles=subs.vtt:fontsdir=/fonts");
    expect(subs).not.toContain("-i aud");
    expect(whatsappArgs(700, { audio: false, subtitles: false }).join(" ")).not.toContain("subtitles=");
  });
});
