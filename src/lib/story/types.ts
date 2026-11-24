// Story series: an episode is a set of scenes (picture, video clip or sound + a line of text) joined by routes.
// Built in Admin → Series → Story builder, played on the web only (/watch/<code>/<n> shows the story reader).
// Pure types and constants: imported by the server, the builder, its preview and the viewer's reader.

export type Bi = { ar: string; en: string };

/** How the episode looks when played (the series picks one; it's a category for the catalogue too). */
export type StoryStyle = "visual_novel" | "chat" | "motion_comic" | "photo";
export const STORY_STYLES: { key: StoryStyle; label: string; hint: string }[] = [
  { key: "visual_novel", label: "Visual novel", hint: "Illustrated scenes with a dialogue box; tap to go on, choose at key moments." },
  { key: "chat", label: "Chat story", hint: "The story is a message thread: characters text each other, pictures arrive as photos." },
  { key: "motion_comic", label: "Motion comic", hint: "Still pictures that slowly zoom and pan, with voice and music; plays on by itself." },
  { key: "photo", label: "Photo story", hint: "Photos of real actors with captions, full screen." },
];
export const STYLE_LABEL: Record<StoryStyle, Bi> = {
  visual_novel: { ar: "رواية مصوّرة", en: "Visual novel" },
  chat: { ar: "قصة محادثة", en: "Chat story" },
  motion_comic: { ar: "كوميك متحرك", en: "Motion comic" },
  photo: { ar: "قصة مصوّرة", en: "Photo story" },
};

export type StoryMediaType = "image" | "video" | "audio";
/** A file uploaded for a scene: `path` is the stored reference (cfimg:/r2:/Supabase path); the server derives `url` from it. */
export type StoryMedia = { path: string; url: string; type: StoryMediaType; name?: string };

/** A person in the story. In a chat story the "phone owner" writes on the end side; everyone else on the start side. */
export type Character = { id: string; name: Bi; color: string; avatar: StoryMedia | null; owner?: boolean };

/** Slow camera move over a still picture (motion comics, but any style can use it). */
export type Motion = "none" | "zoom_in" | "zoom_out" | "pan_start" | "pan_end";
export const MOTIONS: { key: Motion; label: string }[] = [
  { key: "none", label: "Still" },
  { key: "zoom_in", label: "Slow zoom in" },
  { key: "zoom_out", label: "Slow zoom out" },
  { key: "pan_start", label: "Pan to the start side" },
  { key: "pan_end", label: "Pan to the end side" },
];

/** One option at a choice. `to` null ends the episode. A price > 0 makes it a premium choice paid with Ping (once). */
export type Choice = { id: string; label: Bi; to: string | null; price: number; sets: string | null };

/** Where a scene goes after it's shown. */
export type Route =
  | { type: "next"; to: string | null } // continue to a scene (null = end of the episode)
  | { type: "choices"; options: Choice[] }
  | { type: "branch"; flag: string; ifSet: string | null; ifNot: string | null } // depends on an earlier choice (any episode)
  | { type: "end"; ending: Bi | null }; // the episode ends here; an ending name marks one of several endings

/**
 * Planned sound (Studio scripts): Claude writes the cues with ids, then attaches the files made in OpenArt.
 * An episode has at most 2 music beds; a scene names the bed it starts (`musicRef`) or stops it, plays up to
 * 2 sound effects when it opens, and may have its speaker's voice line (`voiceRef`, the file lands in `audio`).
 */
export type MusicBed = { id: string; desc: string; mood: string; media: StoryMedia | null };
export type SfxCue = { id: string; desc: string; media: StoryMedia | null };

export type Scene = {
  id: string;
  /** Builder-only name ("Layla at the door"). */
  name: string;
  image: StoryMedia | null;
  video: StoryMedia | null;
  /** Voice or sound effect for this scene. */
  audio: StoryMedia | null;
  /** Background music; keeps playing into the next scenes until another scene sets music or "stop music". */
  music: StoryMedia | null;
  stopMusic: boolean;
  /** Character id, or null for the narrator. */
  speaker: string | null;
  text: Bi;
  motion: Motion;
  /** Seconds before moving on by itself (0 = wait for a tap). Ignored at choices. */
  auto: number;
  route: Route;
  /** Episode music bed this scene starts ("mus_01"); its file is on the bed. */
  musicRef?: string;
  /** Sound effects that play when the scene opens (at most 2). */
  sfx?: SfxCue[];
  /** Voice line id ("vo_s06"): the speaker says this scene's text; the file is the scene's `audio`. */
  voiceRef?: string;
  /** Picture name from an imported script (e.g. "img_05"): "Match pictures by name" fills `image` from the file with this name. */
  ref?: string;
};

export type StoryGraph = { v: 1; start: string | null; scenes: Scene[]; /** Planned music beds (Studio). */ music?: MusicBed[] };

export const EMPTY_STORY: StoryGraph = { v: 1, start: null, scenes: [] };

export const LIMITS = {
  scenes: 200,
  choices: 4,
  text: 600,
  label: 60,
  name: 80,
  characters: 30,
  maxPrice: 500,
  maxAuto: 60,
  musicBeds: 2,
  sfxPerScene: 2,
} as const;

/** Audio names: "mus_01", "sfx_03", "vo_s06". */
export const AUDIO_REF = /^(mus|sfx|vo)_[a-z0-9_-]{1,30}$/i;
export const audioKindOfRef = (ref: string): "music" | "sfx" | "voice" | null => {
  const m = /^(mus|sfx|vo)_/i.exec(ref);
  return m ? ({ mus: "music", sfx: "sfx", vo: "voice" } as const)[m[1].toLowerCase() as "mus" | "sfx" | "vo"] : null;
};

/** Uploads a scene accepts (web only, so bigger than WhatsApp's limits). */
export const STORY_UPLOADS: Record<string, { type: StoryMediaType; ext: string; maxMb: number }> = {
  "image/jpeg": { type: "image", ext: "jpg", maxMb: 10 },
  "image/png": { type: "image", ext: "png", maxMb: 10 },
  "image/webp": { type: "image", ext: "webp", maxMb: 10 },
  "video/mp4": { type: "video", ext: "mp4", maxMb: 60 },
  "audio/mpeg": { type: "audio", ext: "mp3", maxMb: 20 },
  "audio/mp4": { type: "audio", ext: "m4a", maxMb: 20 },
  "audio/wav": { type: "audio", ext: "wav", maxMb: 20 },
};
export const STORY_ACCEPT: Record<"image" | "video" | "audio", string> = {
  image: "image/jpeg,image/png,image/webp",
  video: "video/mp4",
  audio: "audio/mpeg,audio/mp4,.m4a,.mp3",
};

export const blankScene = (id: string, name = ""): Scene => ({
  id,
  name,
  image: null,
  video: null,
  audio: null,
  music: null,
  stopMusic: false,
  speaker: null,
  text: { ar: "", en: "" },
  motion: "none",
  auto: 0,
  route: { type: "next", to: null },
});

/** A short id that isn't used yet ("s1", "s2", …; choices "c1", …). */
export function nextId(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  for (let n = 1; ; n++) if (!used.has(`${prefix}${n}`)) return `${prefix}${n}`;
}

/** The key a premium choice is bought under (one purchase per viewer, replays free). */
export const choiceKey = (episodeId: string, sceneId: string, choiceId: string) => `${episodeId}:${sceneId}:${choiceId}`;
