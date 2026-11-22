import { describe, expect, it } from "vitest";
import { whatsappArgs } from "@/components/admin/compress";
import { chatVersionPlan, classifyFile, exampleName, originalLang, pendingTracks, playbackLangs, srtToVtt } from "./tracks";

const at = (stream: "attached" | "pending" = "attached") => ({ url: "u", path: "p", stream });

describe("naming rule", () => {
  it("reads videos, dubs and subtitles named by the rule", () => {
    expect(classifyFile("EP07.mp4", "video/mp4")).toEqual({ kind: "video", number: 7, lang: null });
    expect(classifyFile("EP07_audio_en.mp3")).toEqual({ kind: "audio", number: 7, lang: "en" });
    expect(classifyFile("EP07_audio_gulf.m4a")).toEqual({ kind: "audio", number: 7, lang: "gulf" });
    expect(classifyFile("EP12_subs_ar.srt")).toEqual({ kind: "sub", number: 12, lang: "ar" });
    expect(classifyFile("EP03_audio_egy.wav")).toMatchObject({ number: 3, lang: "egy" });
  });
  it("still understands looser names, and leaves the language empty when it isn't there", () => {
    expect(classifyFile("ep07.en.srt")).toMatchObject({ kind: "sub", number: 7, lang: "en" });
    expect(classifyFile("Episode 5 English.mp3")).toMatchObject({ kind: "audio", number: 5, lang: "en" });
    expect(classifyFile("حلقة 5 خليجي.mp3")).toMatchObject({ number: 5, lang: "gulf" });
    expect(classifyFile("EP09_audio.mp3").lang).toBeNull();
    expect(classifyFile("notes.pdf").kind).toBeNull();
  });
  it("shows example names", () => {
    expect(exampleName(7, "video")).toBe("EP07.mp4");
    expect(exampleName(7, "audio", "gulf")).toBe("EP07_audio_gulf.mp3");
    expect(exampleName(7, "subs", "en")).toBe("EP07_subs_en.srt");
  });
  it("maps older dialect values to the original language", () => {
    expect(originalLang("msa")).toBe("ar");
    expect(originalLang("egyptian")).toBe("egy");
    expect(originalLang("en")).toBe("en");
    expect(originalLang(null)).toBe("gulf");
  });
});

describe("subtitles", () => {
  it("turns SubRip into WebVTT", () => {
    expect(srtToVtt("﻿1\r\n00:00:01,500 --> 00:00:03,000\r\nWhere were you?\r\n")).toBe("WEBVTT\n\n1\n00:00:01.500 --> 00:00:03.000\nWhere were you?\n");
  });
});

describe("what the player turns on (one audio at a time)", () => {
  it("plays nothing extra when the video is in the viewer's language", () => {
    expect(playbackLangs("ar", { audio: { en: at() } }, "gulf")).toEqual({ audio: null, subs: null });
    expect(playbackLangs("ar_en_subs", { audio: { gulf: at() } }, "en")).toEqual({ audio: null, subs: null });
  });
  it("switches to the English dub for English viewers of an Arabic series, else English subtitles", () => {
    expect(playbackLangs("ar_en_subs", { audio: { en: at() } }, "gulf")).toEqual({ audio: "English", subs: null });
    expect(playbackLangs("ar_en_subs", { subs: { en: at() } }, "gulf")).toEqual({ audio: null, subs: "en" });
    expect(playbackLangs("ar_en_subs", { audio: { en: at("pending") } }, "gulf")).toEqual({ audio: null, subs: null });
  });
  it("gives Arabic viewers of a foreign series the Gulf dub first", () => {
    expect(playbackLangs("ar", { audio: { egy: at(), gulf: at() } }, "tr")).toEqual({ audio: "خليجي", subs: null });
    expect(playbackLangs("ar", { audio: { egy: at() } }, "tr")).toEqual({ audio: "مصري", subs: null });
    expect(playbackLangs("ar", { subs: { ar: at() } }, "ko")).toEqual({ audio: null, subs: "ar" });
  });
  it("lists tracks still waiting for the video", () => {
    expect(pendingTracks({ subs: { en: at("pending"), ar: at() } }).map((t) => t.lang)).toEqual(["en"]);
  });
});

describe("chat versions", () => {
  it("uses the original, then a dub, then burned-in English subtitles", () => {
    expect(chatVersionPlan("ar", "gulf", {})).toEqual({ kind: "original" });
    expect(chatVersionPlan("en", "gulf", { audio: { en: at() }, subs: { en: at() } })).toEqual({ kind: "dub", lang: "en" });
    expect(chatVersionPlan("en", "gulf", { subs: { en: at() } })).toEqual({ kind: "subs", tag: "en" });
    expect(chatVersionPlan("ar", "tr", { audio: { lev: at() } })).toEqual({ kind: "dub", lang: "lev" });
    expect(chatVersionPlan("ar", "tr", { subs: { ar: at() } })).toBeNull();
  });
  it("builds the ffmpeg command for a dub or burned subtitles", () => {
    expect(whatsappArgs(700, { audio: true, subtitles: false }).join(" ")).toContain("-i aud -map 0:v:0 -map 1:a:0");
    const subs = whatsappArgs(700, { audio: false, subtitles: true }).join(" ");
    expect(subs).toContain("subtitles=subs.vtt:fontsdir=/fonts");
    expect(subs).not.toContain("-i aud");
  });
});
