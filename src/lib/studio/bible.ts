// The series bible Claude writes and draws from: one style line for every picture, the dialect, house rules,
// and each character's locked look (+ reference portrait). Locked once the team approves the portraits. Pure.

export type BibleCharacter = { id: string; look: string; portrait: string | null };
/** One planned episode: Claude proposes them at series setup; the team sends them to Claude as briefs. */
export type OutlineItem = { number: number; title: { ar: string; en: string }; brief: string };
export type Bible = {
  style: string;
  dialect: string;
  rules: string[];
  characters: BibleCharacter[];
  locked: boolean;
  /** The team's idea for the series (written when the series is created in the Studio). */
  brief: string;
  /** How many episodes the team wants. */
  planned: number;
  outline: OutlineItem[];
};

export const EMPTY_BIBLE: Bible = { style: "", dialect: "", rules: [], characters: [], locked: false, brief: "", planned: 0, outline: [] };

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

export function sanitizeBible(v: unknown): Bible {
  const o = obj(v);
  const seen = new Set<string>();
  const characters: BibleCharacter[] = [];
  for (const c of Array.isArray(o.characters) ? o.characters : []) {
    const co = obj(c);
    const id = typeof co.id === "string" && /^[a-z0-9_-]{1,40}$/i.test(co.id) ? co.id.toLowerCase() : null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const portrait = typeof co.portrait === "string" && /^https:\/\/\S{4,800}$/.test(co.portrait) ? co.portrait : null;
    characters.push({ id, look: str(co.look, 800), portrait });
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
  return { style: str(o.style, 800), dialect: str(o.dialect, 60), rules, characters, locked: o.locked === true, brief: str(o.brief, 4000), planned, outline };
}

/**
 * Merge Claude's proposal into the bible. Refused once the team locks it. Claude never changes the team's brief
 * or planned episode count; it proposes style, dialect, rules, characters and the outline.
 */
export function mergeBible(current: Bible, patch: Partial<Pick<Bible, "style" | "dialect" | "rules" | "characters" | "outline">>): { bible: Bible; refused: string[] } {
  const refused: string[] = [];
  if (current.locked) {
    if (patch.characters?.length) refused.push("Characters are locked by the team; their looks and portraits can't change.");
    if (patch.style || patch.dialect || patch.rules?.length || patch.outline?.length) refused.push("The bible is locked; ask the team to change the style, dialect, rules or outline.");
    return { bible: current, refused };
  }
  const byId = new Map(current.characters.map((c) => [c.id, c]));
  for (const c of patch.characters ?? []) byId.set(c.id, { ...byId.get(c.id), ...c, portrait: c.portrait ?? byId.get(c.id)?.portrait ?? null });
  return {
    bible: {
      ...current,
      style: patch.style || current.style,
      dialect: patch.dialect || current.dialect,
      rules: patch.rules?.length ? patch.rules : current.rules,
      characters: [...byId.values()],
      outline: patch.outline?.length ? patch.outline : current.outline,
      locked: false,
    },
    refused,
  };
}
