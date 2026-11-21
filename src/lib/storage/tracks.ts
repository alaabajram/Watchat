// Languages on one episode (pure: used by the admin uploads, the server and the watch page).
// One video per episode; English is either an extra audio track (a dub) or English subtitles.
// Viewers who chose English hear the dub when there is one, otherwise read English subtitles.

import { episodeNumberFromName } from "@/lib/content-meta";

export type TrackLang = "en" | "ar";
export type TrackState = { url: string; path: string; stream: "attached" | "pending" | "error"; error?: string; audio_uid?: string };
export type EpisodeTracks = { subs?: Partial<Record<TrackLang, TrackState>>; audio?: Partial<Record<TrackLang, TrackState>> };

export const SUB_EXTS = ["vtt", "srt"] as const;
export const AUDIO_EXTS = ["mp3", "m4a", "aac", "wav"] as const;
export const TRACK_ACCEPT = ".vtt,.srt,.mp3,.m4a,.aac,.wav";

export type DroppedKind = "video" | "sub" | "audio";

/** What a dropped file is: an episode video, a subtitle file or an audio track, its episode and language. */
export function classifyFile(name: string, mime = ""): { kind: DroppedKind | null; number: number | null; lang: TrackLang } {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  const kind: DroppedKind | null = (SUB_EXTS as readonly string[]).includes(ext)
    ? "sub"
    : (AUDIO_EXTS as readonly string[]).includes(ext) || mime.startsWith("audio/")
      ? "audio"
      : mime.startsWith("video/") || ["mp4", "mov", "m4v", "mkv", "webm"].includes(ext)
        ? "video"
        : null;
  // Language from the name: ep07.en.srt, EP07_English.mp3, حلقة 7 عربي.vtt. Arabic subtitles must be marked;
  // anything else defaults to English (that's what translators usually send).
  const stem = name.replace(/\.[^.]+$/, "");
  const lang: TrackLang = /(^|[^a-z])(ar|ara|arabic)([^a-z]|$)|عربي/i.test(stem) ? "ar" : "en";
  // Strip the language marker before reading the episode number, so "ep07.en" isn't misread.
  const number = episodeNumberFromName(stem.replace(/(^|[^a-z])(en|eng|english|ar|ara|arabic)([^a-z]|$)/gi, " "));
  return { kind, number, lang };
}

/** SubRip (.srt) → WebVTT, which Cloudflare Stream and the browsers read. */
export function srtToVtt(srt: string): string {
  const body = srt
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")
    .trim();
  return `WEBVTT\n\n${body}\n`;
}

/** What the player turns on for this viewer: the English dub if there is one, else English subtitles. */
export function playbackLangs(viewerLanguage: string | null | undefined, tracks: EpisodeTracks | null | undefined): { audio: TrackLang | null; subs: TrackLang | null } {
  if (viewerLanguage !== "ar_en_subs") return { audio: null, subs: null };
  if (tracks?.audio?.en?.stream === "attached") return { audio: "en", subs: null };
  return { audio: null, subs: "en" };
}

/** Tracks still waiting to be attached to the Stream video (the video wasn't ready yet, or it failed). */
export function pendingTracks(tracks: EpisodeTracks | null | undefined): { kind: "subs" | "audio"; lang: TrackLang; state: TrackState }[] {
  const out: { kind: "subs" | "audio"; lang: TrackLang; state: TrackState }[] = [];
  for (const kind of ["subs", "audio"] as const)
    for (const [lang, state] of Object.entries(tracks?.[kind] ?? {}))
      if (state && state.stream !== "attached") out.push({ kind, lang: lang as TrackLang, state });
  return out;
}
