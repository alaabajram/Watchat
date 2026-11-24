// The series bible Claude writes and draws from: one style line for every picture, the dialect, house rules,
// and each character's locked look (+ reference portrait), the series theme tune and each speaking character's
// locked voice (+ reference sample). Locked once the team approves the portraits and voices. Pure.

/**
 * `voice`: a locked 15–30 word description (age, tone, accent, pace); "" = this character never speaks aloud.
 * `voiceSample`: the reference clip every voice line is made from, so the character always sounds the same.
 */
export type BibleCharacter = { id: string; look: string; portrait: string | null; voice: string; voiceSample: string | null };
/** The series theme: every episode's music is built on it. */
export type Theme = { desc: string; url: string | null };
/** One planned episode: Claude proposes them at series setup; the team sends them to Claude as briefs. */
export type OutlineItem = { number: number; title: { ar: string; en: string }; brief: string };
export type Bible = {
  style: string;
  dialect: string;
  rules: string[];
  characters: BibleCharacter[];
  theme: Theme;
  locked: boolean;
  /** The team's idea for the series (written when the series is created in the Studio). */
  brief: string;
  /** How many episodes the team wants. */
  planned: number;
  outline: OutlineItem[];
};

export const EMPTY_BIBLE: Bible = { style: "", dialect: "", rules: [], characters: [], theme: { desc: "", url: null }, locked: false, brief: "", planned: 0, outline: [] };

/** Characters who may have voice lines (a locked voice and its reference sample). */
export const voicedCharacters = (b: Bible) => b.characters.filter((c) => c.voice && c.voiceSample).map((c) => c.id);

/** Where a series is in its setup: waiting for Claude, ready for the team to review, or locked (ready for episodes). */
export type SetupStatus = "needs_claude" | "to_review" | "locked";
export function setupStatus(b: Bible): SetupStatus {
  if (b.locked) return "locked";
  return b.style && b.characters.length && b.outline.length ? "to_review" : "needs_claude";
}
export const SETUP_LABEL: Record<SetupStatus, string> = {
  needs_claude: "Waiting for Claude to set it up",
  to_review: "Bible ready for your review",
  locked: "Locked · ready for episodes",
};

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const httpsUrl = (v: unknown) => (typeof v === "string" && /^https:\/\/\S{4,800}$/.test(v) ? v : null);

export function sanitizeBible(v: unknown): Bible {
  const o = obj(v);
  const seen = new Set<string>();
  const characters: BibleCharacter[] = [];
  for (const c of Array.isArray(o.characters) ? o.characters : []) {
    const co = obj(c);
    const id = typeof co.id === "string" && /^[a-z0-9_-]{1,40}$/i.test(co.id) ? co.id.toLowerCase() : null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    characters.push({ id, look: str(co.look, 800), portrait: httpsUrl(co.portrait), voice: str(co.voice, 300), voiceSample: httpsUrl(co.voiceSample ?? co.voice_sample) });
    if (characters.length >= 30) break;
  }
  const rules = (Array.isArray(o.rules) ? o.rules : typeof o.rules === "string" ? o.rules.split("\n") : [])
    .map((r) => str(r, 200))
    .filter(Boolean)
    .slice(0, 25);
  const seenN = new Set<number>();
  const outline: OutlineItem[] = [];
  for (const it of Array.isArray(o.outline) ? o.outline : []) {
    const io = obj(it);
    const n = Math.round(Number(io.number));
    if (!Number.isInteger(n) || n < 1 || n > 500 || seenN.has(n)) continue;
    seenN.add(n);
    const t = obj(io.title);
    outline.push({ number: n, title: { ar: str(t.ar ?? io.title_ar, 120), en: str(t.en ?? io.title_en, 120) }, brief: str(io.brief, 1500) });
    if (outline.length >= 100) break;
  }
  outline.sort((a, b) => a.number - b.number);
  const planned = Math.max(0, Math.min(500, Math.round(Number(o.planned)) || 0));
  const th = obj(o.theme);
  return {
    style: str(o.style, 800),
    dialect: str(o.dialect, 60),
    rules,
    characters,
    theme: { desc: str(th.desc, 400), url: httpsUrl(th.url) },
    locked: o.locked === true,
    brief: str(o.brief, 4000),
    planned,
    outline,
  };
}

/**
 * Merge Claude's proposal into the bible. Refused once the team locks it. Claude never changes the team's brief
 * or planned episode count; it proposes style, dialect, rules, characters and the outline.
 */
export type BiblePatch = Partial<Pick<Bible, "style" | "dialect" | "rules" | "outline">> & {
  characters?: (Pick<BibleCharacter, "id"> & Partial<Omit<BibleCharacter, "id">>)[];
  theme?: Partial<Theme>;
};

export function mergeBible(current: Bible, patch: BiblePatch): { bible: Bible; refused: string[] } {
  const refused: string[] = [];
  if (current.locked) {
    if (patch.characters?.length) refused.push("Characters are locked by the team; their looks, voices, portraits and voice samples can't change.");
    if (patch.style || patch.dialect || patch.rules?.length || patch.outline?.length || patch.theme?.desc || patch.theme?.url)
      refused.push("The bible is locked; ask the team to change the style, dialect, rules, theme music or outline.");
    return { bible: current, refused };
  }
  const byId = new Map(current.characters.map((c) => [c.id, c]));
  for (const c of patch.characters ?? []) {
    const prev = byId.get(c.id);
    byId.set(c.id, {
      id: c.id,
      look: c.look || prev?.look || "",
      portrait: c.portrait ?? prev?.portrait ?? null,
      voice: c.voice || prev?.voice || "",
      voiceSample: c.voiceSample ?? prev?.voiceSample ?? null,
    });
  }
  return {
    bible: {
      ...current,
      style: patch.style || current.style,
      dialect: patch.dialect || current.dialect,
      rules: patch.rules?.length ? patch.rules : current.rules,
      characters: [...byId.values()],
      theme: { desc: patch.theme?.desc || current.theme.desc, url: patch.theme?.url ?? current.theme.url },
      outline: patch.outline?.length ? patch.outline : current.outline,
      locked: false,
    },
    refused,
  };
}
