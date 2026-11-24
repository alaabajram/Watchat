// Turn whatever the browser sent into a well-formed story (or characters list). Pure: never trusts input,
// drops what doesn't fit, clamps sizes. Media keep only their stored path; the server re-derives the URL
// (see `withUrls`), so a story can never point at an address the browser made up.

import { AUDIO_REF, LIMITS, type Bi, type Character, type Choice, type Motion, type MusicBed, type Route, type Scene, type SfxCue, type StoryGraph, type StoryMedia, type StoryMediaType } from "./types";

const ID = /^[a-z0-9_-]{1,40}$/i;
const REF = /^[a-z0-9_.-]{1,40}$/i;
const FLAG = /^[a-z0-9_-]{1,40}$/i;
const COLOR = /^#[0-9a-f]{6}$/i;
const MOTION_KEYS: Motion[] = ["none", "zoom_in", "zoom_out", "pan_start", "pan_end"];
// Stored paths: Cloudflare Images id, R2 key, or a Supabase "media" path. No "..", no protocol.
const PATH = /^(cfimg:[A-Za-z0-9_-]{1,80}|r2:[A-Za-z0-9_./-]{1,200}|[A-Za-z0-9_./-]{1,200})$/;

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").slice(0, max) : "");
const bi = (v: unknown, max: number): Bi => {
  const o = obj(v);
  return { ar: str(o.ar, max).trim(), en: str(o.en, max).trim() };
};
const int = (v: unknown, min: number, max: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
};
const target = (v: unknown): string | null => (typeof v === "string" && ID.test(v) ? v : null);

export function sanitizeMedia(v: unknown, only?: StoryMediaType): StoryMedia | null {
  const o = obj(v);
  const type = o.type === "image" || o.type === "video" || o.type === "audio" ? o.type : null;
  const path = typeof o.path === "string" ? o.path : "";
  if (!type || (only && type !== only) || !PATH.test(path) || path.includes("..")) return null;
  const url = typeof o.url === "string" && /^https:\/\//.test(o.url) ? o.url.slice(0, 400) : "";
  const name = str(o.name, 80);
  return { path, url, type, ...(name ? { name } : {}) };
}

function sanitizeRoute(v: unknown): Route {
  const o = obj(v);
  if (o.type === "choices") {
    const seen = new Set<string>();
    const options: Choice[] = [];
    for (const c of Array.isArray(o.options) ? o.options : []) {
      const co = obj(c);
      const id = typeof co.id === "string" && ID.test(co.id) && !seen.has(co.id) ? co.id : null;
      if (!id) continue;
      seen.add(id);
      const sets = typeof co.sets === "string" && FLAG.test(co.sets.trim()) ? co.sets.trim().toLowerCase() : null;
      options.push({ id, label: bi(co.label, LIMITS.label), to: target(co.to), price: int(co.price, 0, LIMITS.maxPrice), sets });
      if (options.length >= LIMITS.choices) break;
    }
    return { type: "choices", options };
  }
  if (o.type === "branch") {
    const flag = typeof o.flag === "string" && FLAG.test(o.flag.trim()) ? o.flag.trim().toLowerCase() : "";
    return { type: "branch", flag, ifSet: target(o.ifSet), ifNot: target(o.ifNot) };
  }
  if (o.type === "end") {
    const ending = bi(o.ending, LIMITS.label);
    return { type: "end", ending: ending.ar || ending.en ? ending : null };
  }
  return { type: "next", to: target(o.to) };
}

const audioId = (v: unknown, kind: "mus" | "sfx" | "vo"): string | null => {
  const id = typeof v === "string" ? v.trim().toLowerCase() : "";
  return AUDIO_REF.test(id) && id.startsWith(`${kind}_`) ? id : null;
};

/** Up to 6 kept so the checks can say "too many" instead of silently dropping (the limit is 2). */
function sanitizeSfx(v: unknown): SfxCue[] {
  const out: SfxCue[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(v) ? v : []) {
    const o = typeof raw === "string" ? { id: raw } : obj(raw);
    const id = audioId(o.id, "sfx");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, desc: str(o.desc, 200).trim(), media: sanitizeMedia(o.media, "audio") });
    if (out.length >= 6) break;
  }
  return out;
}

export function sanitizeMusicBeds(v: unknown): MusicBed[] {
  const out: MusicBed[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(v) ? v : []) {
    const o = obj(raw);
    const id = audioId(o.id, "mus");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, desc: str(o.desc, 300).trim(), mood: str(o.mood, 80).trim(), media: sanitizeMedia(o.media, "audio") });
    if (out.length >= 6) break;
  }
  return out;
}

function sanitizeScene(v: unknown): Scene | null {
  const o = obj(v);
  if (typeof o.id !== "string" || !ID.test(o.id)) return null;
  const ref = typeof o.ref === "string" ? o.ref.trim() : typeof o.image_ref === "string" ? o.image_ref.trim() : "";
  // Studio scripts write sound as cues: "audio": { "music": "mus_01" | "stop", "sfx": [{ "id", "desc" }], "voice": { "id" } }.
  const cueForm = o.audio && typeof o.audio === "object" && !("type" in (o.audio as object)) ? obj(o.audio) : null;
  const musicRef = audioId(cueForm ? cueForm.music : o.musicRef, "mus");
  const voiceIn = cueForm ? cueForm.voice : o.voiceRef;
  const voiceRef = audioId(typeof voiceIn === "string" ? voiceIn : obj(voiceIn).id, "vo");
  const sfx = sanitizeSfx(cueForm ? cueForm.sfx : o.sfx);
  return {
    id: o.id,
    name: str(o.name, LIMITS.name).trim(),
    image: sanitizeMedia(o.image, "image"),
    video: sanitizeMedia(o.video, "video"),
    audio: cueForm ? null : sanitizeMedia(o.audio, "audio"),
    music: sanitizeMedia(o.music, "audio"),
    stopMusic: o.stopMusic === true || (cueForm !== null && cueForm.music === "stop"),
    speaker: target(o.speaker),
    text: bi(o.text, LIMITS.text),
    motion: MOTION_KEYS.includes(o.motion as Motion) ? (o.motion as Motion) : "none",
    auto: int(o.auto, 0, LIMITS.maxAuto),
    route: sanitizeRoute(o.route),
    ...(REF.test(ref) ? { ref: ref.toLowerCase() } : {}),
    ...(musicRef ? { musicRef } : {}),
    ...(sfx.length ? { sfx } : {}),
    ...(voiceRef ? { voiceRef } : {}),
  };
}

export function sanitizeStory(v: unknown): StoryGraph {
  const o = obj(v);
  const seen = new Set<string>();
  const scenes: Scene[] = [];
  for (const raw of Array.isArray(o.scenes) ? o.scenes : []) {
    const s = sanitizeScene(raw);
    if (!s || seen.has(s.id)) continue;
    seen.add(s.id);
    scenes.push(s);
    if (scenes.length >= LIMITS.scenes) break;
  }
  // Routes to scenes that no longer exist become "end here".
  const fix = (to: string | null) => (to && seen.has(to) ? to : null);
  for (const s of scenes) {
    const r = s.route;
    if (r.type === "next") r.to = fix(r.to);
    else if (r.type === "choices") r.options.forEach((c) => (c.to = fix(c.to)));
    else if (r.type === "branch") {
      r.ifSet = fix(r.ifSet);
      r.ifNot = fix(r.ifNot);
    }
  }
  const start = typeof o.start === "string" && seen.has(o.start) ? o.start : (scenes[0]?.id ?? null);
  const music = sanitizeMusicBeds(o.music);
  return { v: 1, start, scenes, ...(music.length ? { music } : {}) };
}

export function sanitizeCharacters(v: unknown): Character[] {
  const seen = new Set<string>();
  const out: Character[] = [];
  let owner = false;
  for (const raw of Array.isArray(v) ? v : []) {
    const o = obj(raw);
    if (typeof o.id !== "string" || !ID.test(o.id) || seen.has(o.id)) continue;
    seen.add(o.id);
    const name = bi(o.name, 40);
    if (!name.ar && !name.en) continue;
    const isOwner = o.owner === true && !owner;
    if (isOwner) owner = true;
    out.push({ id: o.id, name, color: typeof o.color === "string" && COLOR.test(o.color) ? o.color.toLowerCase() : "#ff6b5e", avatar: sanitizeMedia(o.avatar, "image"), ...(isOwner ? { owner: true } : {}) });
    if (out.length >= LIMITS.characters) break;
  }
  return out;
}

/** Every stored media path in a story (for keeping file links fresh on the server). */
export function mediaOfStory(g: StoryGraph): StoryMedia[] {
  return [
    ...(g.music ?? []).map((b) => b.media),
    ...g.scenes.flatMap((s) => [s.image, s.video, s.audio, s.music, ...(s.sfx ?? []).map((x) => x.media)]),
  ].filter((m): m is StoryMedia => m !== null);
}

/** Replace each media URL with the one derived from its path (server passes `publicUrlFor`); unknown paths are removed. */
export function withUrls<T extends StoryGraph | Character[]>(value: T, urlFor: (path: string) => string | null, allowedPath: (path: string) => boolean): T {
  const fix = (m: StoryMedia | null): StoryMedia | null => {
    if (!m || !allowedPath(m.path)) return null;
    const url = urlFor(m.path);
    return url ? { ...m, url } : null;
  };
  if (Array.isArray(value)) return value.map((c) => ({ ...c, avatar: fix(c.avatar) })) as T;
  const g = value as StoryGraph;
  return {
    ...g,
    ...(g.music ? { music: g.music.map((b) => ({ ...b, media: fix(b.media) })) } : {}),
    scenes: g.scenes.map((s) => ({
      ...s,
      image: fix(s.image),
      video: fix(s.video),
      audio: fix(s.audio),
      music: fix(s.music),
      ...(s.sfx ? { sfx: s.sfx.map((x) => ({ ...x, media: fix(x.media) })) } : {}),
    })),
  } as T;
}
