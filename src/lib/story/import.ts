// Import a story script (the JSON a writer or ChatGPT produces with the Watchat story prompt) into the builder.
// Pure: finds the JSON inside pasted text, accepts the small differences writers make ("narrator" as speaker,
// several flags on one choice, picture names), and returns sanitised characters and episodes plus notes about
// what was changed. Nothing is published: episodes land as drafts.

import { sanitizeCharacters, sanitizeStory } from "./sanitize";
import { audioKindOfRef, type Bi, type Character, type StoryGraph, type StoryMedia } from "./types";

export type ImportedEpisode = { number: number; title: Bi; story: StoryGraph };
/** A file to fetch for a picture name: `"img_05": "https://…"` in the script's "media" list. */
export type ImportMedia = { ref: string; url: string };
export type StoryImport = { characters: Character[]; episodes: ImportedEpisode[]; media: ImportMedia[]; notes: string[] };

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** The JSON object in a pasted reply (it may sit between explanations or inside a ``` block). */
export function extractJson(text: string): unknown {
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  const candidates = [...fenced, text];
  for (const c of candidates) {
    const start = c.indexOf("{");
    const end = c.lastIndexOf("}");
    if (start < 0 || end <= start) continue;
    try {
      return JSON.parse(c.slice(start, end + 1));
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error("No story JSON found. Paste the JSON block that starts with { \"characters\": … }.");
}

export function parseStoryImport(text: string): StoryImport {
  const raw = obj(extractJson(text));
  const notes: string[] = [];
  const characters = sanitizeCharacters(
    (Array.isArray(raw.characters) ? raw.characters : []).map((c) => {
      const o = obj(c);
      return { ...o, id: typeof o.id === "string" ? o.id.toLowerCase() : o.id };
    }),
  );
  const people = new Set(characters.map((c) => c.id));

  const episodes: ImportedEpisode[] = [];
  const seen = new Set<number>();
  for (const e of Array.isArray(raw.episodes) ? raw.episodes : []) {
    const eo = obj(e);
    const number = Math.round(Number(eo.number));
    if (!Number.isInteger(number) || number < 1 || number > 500 || seen.has(number)) continue;
    seen.add(number);
    const so = obj(eo.story);
    const scenes = (Array.isArray(so.scenes) ? so.scenes : []).map((sc) => {
      const o = obj(sc);
      // "narrator", "" or an unknown name → narrator (null); names are matched case-insensitively.
      let speaker = typeof o.speaker === "string" ? o.speaker.toLowerCase() : null;
      if (speaker && !people.has(speaker)) {
        if (speaker !== "narrator") notes.push(`Episode ${number}, ${o.id}: speaker "${speaker}" isn't a character, so the narrator says it.`);
        speaker = null;
      }
      const route = obj(o.route);
      if (route.type === "choices" && Array.isArray(route.options)) {
        route.options = route.options.map((c) => {
          const co = obj(c);
          if (Array.isArray(co.sets)) {
            const flags = co.sets.filter((f): f is string => typeof f === "string");
            if (flags.length > 1) notes.push(`Episode ${number}, ${o.id}: a choice set ${flags.join(" + ")}; only "${flags[0]}" is kept (one per choice).`);
            return { ...co, sets: flags[0] ?? null };
          }
          return co;
        });
      }
      return { ...o, speaker, route };
    });
    const t = obj(eo.title);
    const story = sanitizeStory({ ...so, scenes });
    const dropped = scenes.length - story.scenes.length;
    if (dropped > 0) notes.push(`Episode ${number}: ${dropped} scene(s) had no usable id and were skipped.`);
    episodes.push({
      number,
      title: { ar: typeof t.ar === "string" ? t.ar.slice(0, 200) : "", en: typeof t.en === "string" ? t.en.slice(0, 200) : "" },
      story,
    });
  }
  if (!episodes.length) throw new Error("The JSON has no episodes with scenes.");
  const media = parseMediaList(raw.media, notes);
  return { characters, episodes: episodes.sort((a, b) => a.number - b.number), media, notes };
}

/**
 * The "media" list: an object { "img_01": "https://…" } or an array [{ "ref": "img_01", "url": "https://…" }].
 * Only https addresses; one file per picture name.
 */
export function parseMediaList(v: unknown, notes: string[] = []): ImportMedia[] {
  const pairs: [unknown, unknown][] = Array.isArray(v) ? v.map((x) => [obj(x).ref ?? obj(x).image_ref, obj(x).url]) : Object.entries(obj(v));
  const out = new Map<string, string>();
  for (const [r, u] of pairs) {
    const ref = typeof r === "string" ? refFromFileName(r) : "";
    if (!/^[a-z0-9_.-]{1,40}$/.test(ref)) continue;
    if (typeof u !== "string" || !/^https:\/\/[^\s]{4,1500}$/.test(u.trim())) {
      notes.push(`Media "${ref}": not an https address, skipped.`);
      continue;
    }
    out.set(ref, u.trim());
  }
  return [...out.entries()].map(([ref, url]) => ({ ref, url }));
}

/** Is this address on an allowed host (the host itself or a subdomain of one)? */
export function hostAllowed(url: string, hosts: string[]): boolean {
  let h: string;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    h = u.hostname.toLowerCase();
  } catch {
    return false;
  }
  return hosts.some((a) => h === a || h.endsWith(`.${a}`));
}

export type FetchedKind = { type: "image" | "video" | "audio"; ext: string };

/** Picture, clip or sound, from the type the server answered with (or the address's file ending). */
export function mediaKindOf(url: string, contentType = ""): FetchedKind | null {
  const ct = contentType.split(";")[0].trim().toLowerCase();
  const byType: Record<string, FetchedKind> = {
    "image/jpeg": { type: "image", ext: "jpg" },
    "image/png": { type: "image", ext: "png" },
    "image/webp": { type: "image", ext: "webp" },
    "video/mp4": { type: "video", ext: "mp4" },
    "audio/mpeg": { type: "audio", ext: "mp3" },
    "audio/mp3": { type: "audio", ext: "mp3" },
    "audio/mp4": { type: "audio", ext: "m4a" },
    "audio/x-m4a": { type: "audio", ext: "m4a" },
    "audio/wav": { type: "audio", ext: "wav" },
    "audio/x-wav": { type: "audio", ext: "wav" },
    "audio/wave": { type: "audio", ext: "wav" },
  };
  if (byType[ct]) return byType[ct];
  const m = /\.(jpe?g|png|webp|mp4|mp3|m4a|wav)(?:$|[?#])/i.exec(url);
  if (!m) return null;
  const e = m[1].toLowerCase();
  if (e === "mp4") return { type: "video", ext: "mp4" };
  if (e === "mp3" || e === "m4a" || e === "wav") return { type: "audio", ext: e };
  return { type: "image", ext: e === "jpeg" ? "jpg" : e };
}

/** Max size per kind when fetching from a media list (sounds are small; WhatsApp-free, web only). */
export const FETCH_MAX_MB: Record<FetchedKind["type"], number> = { image: 10, video: 60, audio: 10 };

/**
 * Put a sound on the episode by its name: "mus_01" on that music bed, "sfx_03" on every scene cue with that
 * id, "vo_s06" as the voice of the scene with that voice line.
 */
export function applyAudio(g: StoryGraph, ref: string, media: StoryMedia): { story: StoryGraph; count: number } {
  const key = ref.toLowerCase();
  const kind = audioKindOfRef(key);
  let count = 0;
  if (kind === "music") {
    if (!(g.music ?? []).some((b) => b.id === key)) return { story: g, count: 0 };
    const music = (g.music ?? []).map((b) => (b.id === key ? { ...b, media } : b));
    // Reported as the scenes it plays under (at least 1: the bed itself).
    count = Math.max(1, g.scenes.filter((s) => s.musicRef === key).length);
    return { story: { ...g, music }, count };
  }
  const scenes = g.scenes.map((s) => {
    if (kind === "sfx" && s.sfx?.some((x) => x.id === key)) {
      count++;
      return { ...s, sfx: s.sfx.map((x) => (x.id === key ? { ...x, media } : x)) };
    }
    if (kind === "voice" && s.voiceRef === key) {
      count++;
      return { ...s, audio: media };
    }
    return s;
  });
  return { story: { ...g, scenes }, count };
}

/** Put a fetched file on every scene with this picture name: pictures as the image, clips as the scene's video. */
export function applyMedia(g: StoryGraph, ref: string, media: NonNullable<StoryGraph["scenes"][number]["image"]>): { story: StoryGraph; count: number } {
  if (media.type === "image") return applyPicture(g, ref, media);
  if (media.type === "audio") return applyAudio(g, ref, media);
  let count = 0;
  const key = ref.toLowerCase();
  const scenes = g.scenes.map((s) => {
    if (s.ref !== key) return s;
    count++;
    return { ...s, video: media };
  });
  return { story: { ...g, scenes }, count };
}

/** Picture names used by these stories, with how many scenes use each (for the "pictures to make" list). */
export function pictureRefs(graphs: StoryGraph[]): { ref: string; scenes: number; missing: number }[] {
  const out = new Map<string, { scenes: number; missing: number }>();
  for (const g of graphs)
    for (const s of g.scenes)
      if (s.ref) {
        const r = out.get(s.ref) ?? { scenes: 0, missing: 0 };
        r.scenes++;
        if (!s.image && !s.video) r.missing++;
        out.set(s.ref, r);
      }
  return [...out.entries()].map(([ref, r]) => ({ ref, ...r })).sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }));
}

/** Put an uploaded picture on every scene whose picture name matches (file "img_05.jpg" → ref "img_05"). */
export function applyPicture(g: StoryGraph, ref: string, image: NonNullable<StoryGraph["scenes"][number]["image"]>): { story: StoryGraph; count: number } {
  let count = 0;
  const key = ref.toLowerCase();
  const scenes = g.scenes.map((s) => {
    if (s.ref !== key) return s;
    count++;
    return { ...s, image };
  });
  return { story: { ...g, scenes }, count };
}

/** "IMG_05 (1).JPG" → "img_05" */
export const refFromFileName = (name: string) =>
  name
    .replace(/\.[^.]+$/, "")
    .replace(/\s*\(\d+\)$/, "")
    .trim()
    .toLowerCase();

/** Take a sound's file off the episode (the team asked for a redo), keeping its cue so it shows as missing. */
export function clearAudio(g: StoryGraph, ref: string): { story: StoryGraph; count: number } {
  const key = ref.toLowerCase();
  let count = 0;
  const music = g.music?.map((b) => (b.id === key && b.media ? (count++, { ...b, media: null }) : b));
  const scenes = g.scenes.map((s) => {
    let next = s;
    if (s.sfx?.some((x) => x.id === key && x.media)) {
      count++;
      next = { ...next, sfx: s.sfx.map((x) => (x.id === key ? { ...x, media: null } : x)) };
    }
    if (s.voiceRef === key && s.audio) {
      count++;
      next = { ...next, audio: null };
    }
    return next;
  });
  return { story: { ...g, scenes, ...(music ? { music } : {}) }, count };
}

/** Keep pictures and sounds already made when a script is rewritten (same picture name / sound id). */
export function keepMade(next: StoryGraph, old: StoryGraph | null): StoryGraph {
  if (!old) return next;
  const pics = new Map(old.scenes.filter((x) => x.ref && (x.image || x.video)).map((x) => [x.ref!, x]));
  const beds = new Map((old.music ?? []).filter((b) => b.media).map((b) => [b.id, b.media]));
  const sfx = new Map(old.scenes.flatMap((x) => x.sfx ?? []).filter((x) => x.media).map((x) => [x.id, x.media]));
  const voices = new Map(old.scenes.filter((x) => x.voiceRef && x.audio).map((x) => [x.voiceRef!, x.audio]));
  return {
    ...next,
    ...(next.music ? { music: next.music.map((b) => ({ ...b, media: b.media ?? beds.get(b.id) ?? null })) } : {}),
    scenes: next.scenes.map((x) => ({
      ...x,
      ...(x.ref && pics.has(x.ref) ? { image: pics.get(x.ref)!.image, video: pics.get(x.ref)!.video } : {}),
      ...(x.sfx ? { sfx: x.sfx.map((c) => ({ ...c, media: c.media ?? sfx.get(c.id) ?? null })) } : {}),
      ...(x.voiceRef && !x.audio && voices.has(x.voiceRef) ? { audio: voices.get(x.voiceRef)! } : {}),
    })),
  };
}
