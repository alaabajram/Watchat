// Import a story script (the JSON a writer or ChatGPT produces with the Watchat story prompt) into the builder.
// Pure: finds the JSON inside pasted text, accepts the small differences writers make ("narrator" as speaker,
// several flags on one choice, picture names), and returns sanitised characters and episodes plus notes about
// what was changed. Nothing is published: episodes land as drafts.

import { sanitizeCharacters, sanitizeStory } from "./sanitize";
import type { Bi, Character, StoryGraph } from "./types";

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

/** Picture or clip, from the address's file ending (or the type the server answered with). */
export function mediaKindOf(url: string, contentType = ""): { type: "image" | "video"; ext: string } | null {
  const ct = contentType.split(";")[0].trim().toLowerCase();
  const byType: Record<string, { type: "image" | "video"; ext: string }> = {
    "image/jpeg": { type: "image", ext: "jpg" },
    "image/png": { type: "image", ext: "png" },
    "image/webp": { type: "image", ext: "webp" },
    "video/mp4": { type: "video", ext: "mp4" },
  };
  if (byType[ct]) return byType[ct];
  const m = /\.(jpe?g|png|webp|mp4)(?:$|[?#])/i.exec(url);
  if (!m) return null;
  const e = m[1].toLowerCase();
  return e === "mp4" ? { type: "video", ext: "mp4" } : { type: "image", ext: e === "jpeg" ? "jpg" : e };
}

/** Put a fetched file on every scene with this picture name: pictures as the image, clips as the scene's video. */
export function applyMedia(g: StoryGraph, ref: string, media: NonNullable<StoryGraph["scenes"][number]["image"]>): { story: StoryGraph; count: number } {
  if (media.type === "image") return applyPicture(g, ref, media);
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
