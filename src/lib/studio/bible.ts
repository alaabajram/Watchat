// The series bible Claude writes and draws from: one style line for every picture, the dialect, house rules,
// and each character's locked look (+ reference portrait). Locked once the team approves the portraits. Pure.

export type BibleCharacter = { id: string; look: string; portrait: string | null };
export type Bible = { style: string; dialect: string; rules: string[]; characters: BibleCharacter[]; locked: boolean };

export const EMPTY_BIBLE: Bible = { style: "", dialect: "", rules: [], characters: [], locked: false };

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
  return { style: str(o.style, 800), dialect: str(o.dialect, 60), rules, characters, locked: o.locked === true };
}

/** Merge Claude's proposal into the bible: refused for characters once locked; style/dialect/rules stay editable only by the team once locked. */
export function mergeBible(current: Bible, patch: Partial<Bible>): { bible: Bible; refused: string[] } {
  const refused: string[] = [];
  if (current.locked) {
    if (patch.characters?.length) refused.push("Characters are locked by the team; their looks and portraits can't change.");
    if (patch.style || patch.dialect || patch.rules?.length) refused.push("The bible is locked; ask the team to change the style, dialect or rules.");
    return { bible: current, refused };
  }
  const byId = new Map(current.characters.map((c) => [c.id, c]));
  for (const c of patch.characters ?? []) byId.set(c.id, { ...byId.get(c.id), ...c, portrait: c.portrait ?? byId.get(c.id)?.portrait ?? null });
  return {
    bible: {
      style: patch.style || current.style,
      dialect: patch.dialect || current.dialect,
      rules: patch.rules?.length ? patch.rules : current.rules,
      characters: [...byId.values()],
      locked: false,
    },
    refused,
  };
}
