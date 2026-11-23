// Import a story script (the JSON a writer or ChatGPT produces with the Watchat story prompt) into the builder.
// Pure: finds the JSON inside pasted text, accepts the small differences writers make ("narrator" as speaker,
// several flags on one choice, picture names), and returns sanitised characters and episodes plus notes about
// what was changed. Nothing is published: episodes land as drafts.

import { sanitizeCharacters, sanitizeStory } from "./sanitize";
import type { Bi, Character, StoryGraph } from "./types";

export type ImportedEpisode = { number: number; title: Bi; story: StoryGraph };
export type StoryImport = { characters: Character[]; episodes: ImportedEpisode[]; notes: string[] };

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
  return { characters, episodes: episodes.sort((a, b) => a.number - b.number), notes };
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
