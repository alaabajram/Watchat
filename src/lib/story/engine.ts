// Playing a story: where each scene leads, given the viewer's earlier choices. Pure; the reader (web and the
// builder's preview) and the server (checking a premium choice) use the same rules.

import type { Choice, Scene, StoryGraph } from "./types";

export const sceneOf = (g: StoryGraph, id: string | null | undefined): Scene | null => (id ? (g.scenes.find((s) => s.id === id) ?? null) : null);

/** Where to begin: the saved scene if it still exists, else the start. */
export const startOf = (g: StoryGraph, resumeAt?: string | null): Scene | null => sceneOf(g, resumeAt) ?? sceneOf(g, g.start) ?? g.scenes[0] ?? null;

/** Every scene a route can lead to (for the map, validation and "reachable"). */
export function targetsOf(s: Scene): (string | null)[] {
  const r = s.route;
  if (r.type === "next") return [r.to];
  if (r.type === "choices") return r.options.map((c) => c.to);
  if (r.type === "branch") return [r.ifSet, r.ifNot];
  return [];
}

/** Does the episode end after this scene (whatever the viewer does)? */
export const endsHere = (s: Scene) => s.route.type === "end" || (s.route.type === "next" && s.route.to === null);

export type Step =
  | { kind: "scene"; scene: Scene; setFlag: string | null }
  | { kind: "end"; ending: string | null; setFlag: string | null }
  | { kind: "wait" }; // a choice is needed (or a premium one isn't paid)

/**
 * Move on from `from` (after it was shown). At a choice, pass the choice id (premium ones only when `paid` says so).
 * A branch goes one way or the other by a flag an earlier choice set. An ending's key is its scene id.
 */
export function advance(
  g: StoryGraph,
  from: Scene,
  opts: { choiceId?: string | null; flags: ReadonlySet<string>; paid?: (c: Choice) => boolean },
): Step {
  let setFlag: string | null = null;
  let to: string | null;
  const r = from.route;
  if (r.type === "end") return { kind: "end", ending: r.ending ? from.id : null, setFlag };
  if (r.type === "choices") {
    const c = r.options.find((o) => o.id === opts.choiceId);
    if (!c) return { kind: "wait" };
    if (c.price > 0 && !(opts.paid?.(c) ?? false)) return { kind: "wait" };
    setFlag = c.sets;
    to = c.to;
  } else if (r.type === "branch") {
    to = opts.flags.has(r.flag) ? r.ifSet : r.ifNot;
  } else to = r.to;

  const next = sceneOf(g, to);
  return next ? { kind: "scene", scene: next, setFlag } : { kind: "end", ending: null, setFlag };
}

/** Scenes the viewer can reach from the start (any choices, any flags). */
export function reachable(g: StoryGraph): Set<string> {
  const seen = new Set<string>();
  const queue = [g.start ?? g.scenes[0]?.id].filter((x): x is string => Boolean(x));
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    const s = sceneOf(g, id);
    if (!s) continue;
    seen.add(id);
    for (const t of targetsOf(s)) if (t && !seen.has(t)) queue.push(t);
  }
  return seen;
}

/** Flags set by any choice in these stories (for "depends on an earlier choice" pickers and checks). */
export function flagsSetIn(graphs: StoryGraph[]): string[] {
  const out = new Set<string>();
  for (const g of graphs) for (const s of g.scenes) if (s.route.type === "choices") for (const c of s.route.options) if (c.sets) out.add(c.sets);
  return [...out].sort();
}

/** A ready-to-play order of scenes along the first option everywhere (used for counts and the default preview). */
export function mainPath(g: StoryGraph, flags: ReadonlySet<string> = new Set()): Scene[] {
  const out: Scene[] = [];
  const seen = new Set<string>();
  let s = startOf(g);
  const f = new Set(flags);
  while (s && !seen.has(s.id)) {
    seen.add(s.id);
    out.push(s);
    const first = s.route.type === "choices" ? (s.route.options.find((o) => o.price === 0) ?? s.route.options[0]) : null;
    const step = advance(g, s, { choiceId: first?.id ?? null, flags: f, paid: () => true });
    if (step.kind !== "scene") break;
    if (step.setFlag) f.add(step.setFlag);
    s = step.scene;
  }
  return out;
}
