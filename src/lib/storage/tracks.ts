// Languages on one episode (pure: used by the admin uploads, the server and the watch page).
//
// One video per episode, in the series' original language. Any number of extra audio tracks (dubs: English,
// Gulf Arabic, Egyptian …) and subtitle files are attached to that same video. A viewer hears their language
// when the video is in it, else a dub in their language, else reads subtitles in it. Only one audio plays at a
// time: the player switches tracks, it doesn't mix them.
//
// File naming rule for the content team (the tag is the language code below):
//   EP07.mp4               the episode video (original language)
//   EP07_audio_en.mp3      a dub (audio only: .mp3 .m4a .aac .wav)
//   EP07_subs_en.srt       subtitles (.srt or .vtt)

import { episodeNumberFromName } from "@/lib/content-meta";

export type LangKey = "ar" | "gulf" | "egy" | "lev" | "en" | "fr" | "tr" | "hi" | "ur" | "ko" | "es";
/** Viewer languages the app has today. */
export type ViewerFamily = "ar" | "en";

type LangInfo = { en: string; ar: string; /** Label on the Stream audio track (unique). */ label: string; family: string; /** BCP-47 tag for subtitles. */ tag: string };
export const LANGS: Record<LangKey, LangInfo> = {
  ar: { en: "Arabic (Standard)", ar: "العربية الفصحى", label: "العربية", family: "ar", tag: "ar" },
  gulf: { en: "Gulf Arabic", ar: "خليجي", label: "خليجي", family: "ar", tag: "ar" },
  egy: { en: "Egyptian Arabic", ar: "مصري", label: "مصري", family: "ar", tag: "ar" },
  lev: { en: "Levantine Arabic", ar: "شامي", label: "شامي", family: "ar", tag: "ar" },
  en: { en: "English", ar: "الإنجليزية", label: "English", family: "en", tag: "en" },
  fr: { en: "French", ar: "الفرنسية", label: "Français", family: "fr", tag: "fr" },
  tr: { en: "Turkish", ar: "التركية", label: "Türkçe", family: "tr", tag: "tr" },
  hi: { en: "Hindi", ar: "الهندية", label: "हिन्दी", family: "hi", tag: "hi" },
  ur: { en: "Urdu", ar: "الأردية", label: "اردو", family: "ur", tag: "ur" },
  ko: { en: "Korean", ar: "الكورية", label: "한국어", family: "ko", tag: "ko" },
  es: { en: "Spanish", ar: "الإسبانية", label: "Español", family: "es", tag: "es" },
};
export const LANG_KEYS = Object.keys(LANGS) as LangKey[];
/** Which dub an Arabic viewer prefers, in order (Gulf first: the main market). */
const PREFER: Record<ViewerFamily, LangKey[]> = { ar: ["gulf", "ar", "lev", "egy"], en: ["en"] };

/** The series' original language from its saved value (older series saved the dialect name). */
export function originalLang(saved: string | null | undefined): LangKey {
  const v = String(saved ?? "").toLowerCase();
  const legacy: Record<string, LangKey> = { msa: "ar", egyptian: "egy", levantine: "lev", english: "en" };
  if (legacy[v]) return legacy[v];
  return (LANG_KEYS as string[]).includes(v) ? (v as LangKey) : "gulf";
}

export type TrackState = { url: string; path: string; stream: "attached" | "pending" | "error"; error?: string; audio_uid?: string };
/** audio: keyed by language key (en, gulf …); subs: keyed by subtitle tag (ar, en …). */
export type EpisodeTracks = { subs?: Partial<Record<string, TrackState>>; audio?: Partial<Record<string, TrackState>> };

export const SUB_EXTS = ["vtt", "srt"] as const;
export const AUDIO_EXTS = ["mp3", "m4a", "aac", "wav"] as const;
export const TRACK_ACCEPT = ".vtt,.srt,.mp3,.m4a,.aac,.wav";

export type DroppedKind = "video" | "sub" | "audio";

/** Spellings people use for each tag in file names (the tag itself always works). */
const ALIASES: Record<string, LangKey> = {
  english: "en", eng: "en", arabic: "ar", msa: "ar", fusha: "ar", فصحى: "ar", عربي: "ar", khaleeji: "gulf", khaliji: "gulf", خليجي: "gulf",
  egyptian: "egy", masri: "egy", مصري: "egy", levantine: "lev", shami: "lev", شامي: "lev", french: "fr", turkish: "tr", hindi: "hi", urdu: "ur", korean: "ko", spanish: "es",
};

/** What a dropped file is: an episode video, subtitles or a dub; its episode; and its language (null = not in the name). */
export function classifyFile(name: string, mime = ""): { kind: DroppedKind | null; number: number | null; lang: LangKey | null } {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  const kind: DroppedKind | null = (SUB_EXTS as readonly string[]).includes(ext)
    ? "sub"
    : (AUDIO_EXTS as readonly string[]).includes(ext) || mime.startsWith("audio/")
      ? "audio"
      : mime.startsWith("video/") || ["mp4", "mov", "m4v", "mkv", "webm"].includes(ext)
        ? "video"
        : null;
  const stem = name.replace(/\.[^.]+$/, "");
  const words = stem.toLowerCase().split(/[\s._\-()[\]]+/).filter(Boolean);
  let lang: LangKey | null = null;
  for (const w of words) {
    if ((LANG_KEYS as string[]).includes(w)) lang = w as LangKey;
    else if (ALIASES[w]) lang = ALIASES[w];
  }
  // Drop the language and kind words before reading the episode number ("EP07_audio_en").
  const rest = words.filter((w) => !(LANG_KEYS as string[]).includes(w) && !ALIASES[w] && !["audio", "subs", "sub", "subtitles", "dub"].includes(w));
  const number = episodeNumberFromName(rest.join(" "));
  return { kind, number, lang: kind === "video" ? null : lang };
}

/** The file name the naming rule asks for (shown as an example in the uploader). */
export const exampleName = (n: number, kind: "video" | "audio" | "subs", lang?: LangKey, ext?: string) =>
  `EP${String(n).padStart(2, "0")}${kind === "video" ? "" : `_${kind}_${lang ?? "en"}`}.${ext ?? (kind === "video" ? "mp4" : kind === "audio" ? "mp3" : "srt")}`;

/** SubRip (.srt) → WebVTT, which Cloudflare Stream and the browsers read. */
export function srtToVtt(srt: string): string {
  const body = srt
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")
    .trim();
  return `WEBVTT\n\n${body}\n`;
}

/** The viewer's language family from their saved choice. */
export const viewerFamily = (viewerLanguage: string | null | undefined): ViewerFamily => (viewerLanguage === "ar_en_subs" ? "en" : "ar");

/** The dub to use for a language family (best match first), if one is attached. */
export function dubFor(family: ViewerFamily, tracks: EpisodeTracks | null | undefined): LangKey | null {
  return PREFER[family].find((k) => tracks?.audio?.[k]?.stream === "attached") ?? null;
}

/**
 * What the player turns on: nothing when the video is already in the viewer's language; else a dub in it
 * (the original sound is replaced, not mixed); else subtitles in it. `audio` is the Stream track label.
 */
export function playbackLangs(
  viewerLanguage: string | null | undefined,
  tracks: EpisodeTracks | null | undefined,
  original: LangKey = "gulf",
): { audio: string | null; subs: string | null } {
  const want = viewerFamily(viewerLanguage);
  if (LANGS[original].family === want) return { audio: null, subs: null };
  const dub = dubFor(want, tracks);
  if (dub) return { audio: LANGS[dub].label, subs: null };
  return { audio: null, subs: tracks?.subs?.[want]?.stream === "attached" ? want : null };
}

/** For the chat version in a language: the dub to use as the sound, or subtitles to burn in, or nothing needed. */
export function chatVersionPlan(family: ViewerFamily, original: LangKey, tracks: EpisodeTracks | null | undefined): { kind: "original" } | { kind: "dub"; lang: LangKey } | { kind: "subs"; tag: string } | null {
  if (LANGS[original].family === family) return { kind: "original" };
  const dub = PREFER[family].find((k) => tracks?.audio?.[k]);
  if (dub) return { kind: "dub", lang: dub };
  if (family === "en" && tracks?.subs?.en) return { kind: "subs", tag: "en" }; // Arabic can't be burned in yet (needs text shaping)
  return null;
}

/** Tracks still waiting to be attached to the Stream video (the video wasn't ready yet, or it failed). */
export function pendingTracks(tracks: EpisodeTracks | null | undefined): { kind: "subs" | "audio"; lang: string; state: TrackState }[] {
  const out: { kind: "subs" | "audio"; lang: string; state: TrackState }[] = [];
  for (const kind of ["subs", "audio"] as const)
    for (const [lang, state] of Object.entries(tracks?.[kind] ?? {}))
      if (state && state.stream !== "attached") out.push({ kind, lang, state });
  return out;
}
