// What stops a story episode from being published (errors) and what's worth a look (warnings). Pure; the builder
// shows the same list live and Publish refuses while there are errors.

import { endsHere, reachable, sceneOf, targetsOf } from "./engine";
import type { Character, StoryGraph } from "./types";

export type StoryIssue = { level: "error" | "warning"; sceneId: string | null; message: string };

const label = (name: string, id: string) => (name ? `"${name}"` : id);

/**
 * `flagsKnown`: flags any choice of this series sets (other episodes included), so a branch here can depend on them.
 * `characters`: the series' people, so a scene's speaker must still exist.
 */
export function validateStory(g: StoryGraph, opts: { flagsKnown?: string[]; characters?: Character[] } = {}): StoryIssue[] {
  const issues: StoryIssue[] = [];
  const err = (sceneId: string | null, message: string) => issues.push({ level: "error", sceneId, message });
  const warn = (sceneId: string | null, message: string) => issues.push({ level: "warning", sceneId, message });

  if (g.scenes.length === 0) {
    err(null, "Add at least one scene.");
    return issues;
  }
  if (!sceneOf(g, g.start)) err(null, "Pick the scene the episode starts with.");

  const known = new Set(opts.flagsKnown ?? []);
  const people = new Set((opts.characters ?? []).map((c) => c.id));
  for (const s of g.scenes) {
    const n = label(s.name, s.id);
    const hasPicture = Boolean(s.image || s.video);
    const hasText = Boolean(s.text.ar || s.text.en);
    if (!hasPicture && !hasText && !s.audio) err(s.id, `Scene ${n} is empty: add a picture, a video, a sound or a line of text.`);
    if (hasText && !s.text.ar) warn(s.id, `Scene ${n} has no Arabic text (Arabic viewers will see the English).`);
    if (hasText && !s.text.en) warn(s.id, `Scene ${n} has no English text (English viewers will see the Arabic).`);
    if (s.speaker && opts.characters && !people.has(s.speaker)) err(s.id, `Scene ${n}: its speaker was removed from the characters.`);

    const r = s.route;
    if (r.type === "choices") {
      if (r.options.length < 1) err(s.id, `Scene ${n}: add at least one choice, or change it to "Continue".`);
      for (const c of r.options) {
        if (!c.label.ar && !c.label.en) err(s.id, `Scene ${n}: a choice has no text.`);
        if (c.to === s.id) err(s.id, `Scene ${n}: a choice leads back to the same scene.`);
      }
      if (r.options.length > 0 && r.options.every((c) => c.price > 0)) err(s.id, `Scene ${n}: every choice costs Ping. Keep one free choice so nobody gets stuck.`);
    }
    if (r.type === "branch") {
      if (!r.flag) err(s.id, `Scene ${n}: pick which earlier choice it depends on.`);
      else if (!known.has(r.flag)) warn(s.id, `Scene ${n}: no choice sets "${r.flag}" yet, so viewers always take the "otherwise" way.`);
    }
    if (r.type === "next" && r.to === s.id) err(s.id, `Scene ${n} continues to itself.`);
  }

  // Every scene reachable, and every path can end.
  const reach = reachable(g);
  for (const s of g.scenes) if (!reach.has(s.id)) warn(s.id, `Scene ${label(s.name, s.id)} can't be reached from the start.`);
  const canEnd = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const s of g.scenes) {
      if (canEnd.has(s.id)) continue;
      if (endsHere(s) || targetsOf(s).some((t) => t === null || canEnd.has(t))) {
        canEnd.add(s.id);
        grew = true;
      }
    }
  }
  if (g.start && !canEnd.has(g.start)) err(null, "The episode never ends: every path loops. Add an ending.");
  for (const id of reach) if (!canEnd.has(id) && id !== g.start) err(id, `Scene ${label(sceneOf(g, id)?.name ?? "", id)} is in a loop with no way out.`);
  return issues;
}

export const hasErrors = (issues: StoryIssue[]) => issues.some((i) => i.level === "error");
