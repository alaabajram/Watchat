// What stops a story episode from being published (errors) and what's worth a look (warnings). Pure; the builder
// shows the same list live and Publish refuses while there are errors.

import { endsHere, reachable, sceneOf, targetsOf } from "./engine";
import { LIMITS, type Character, type StoryGraph } from "./types";

export type StoryIssue = { level: "error" | "warning"; sceneId: string | null; message: string };

const label = (name: string, id: string) => (name ? `"${name}"` : id);

/**
 * `flagsKnown`: flags any choice of this series sets (other episodes included), so a branch here can depend on them.
 * `characters`: the series' people, so a scene's speaker must still exist.
 * `voices`: characters with a locked voice in the series bible (Studio); voice lines for anyone else are refused.
 */
export function validateStory(g: StoryGraph, opts: { flagsKnown?: string[]; characters?: Character[]; voices?: string[] } = {}): StoryIssue[] {
  const issues: StoryIssue[] = [];
  const err = (sceneId: string | null, message: string) => issues.push({ level: "error", sceneId, message });
  const warn = (sceneId: string | null, message: string) => issues.push({ level: "warning", sceneId, message });

  if (g.scenes.length === 0) {
    err(null, "Add at least one scene.");
    return issues;
  }
  if (!sceneOf(g, g.start)) err(null, "Pick the scene the episode starts with.");

  const known = new Set(opts.flagsKnown ?? []);
  const beds = new Set((g.music ?? []).map((b) => b.id));
  if ((g.music ?? []).length > LIMITS.musicBeds) err(null, `At most ${LIMITS.musicBeds} music beds per episode (there are ${(g.music ?? []).length}).`);
  const voices = opts.voices ? new Set(opts.voices) : null;
  const people = new Set((opts.characters ?? []).map((c) => c.id));
  for (const s of g.scenes) {
    const n = label(s.name, s.id);
    const hasPicture = Boolean(s.image || s.video);
    const hasText = Boolean(s.text.ar || s.text.en);
    if (!hasPicture && !hasText && !s.audio) err(s.id, `Scene ${n} is empty: add a picture, a video, a sound or a line of text.`);
    if (hasText && !s.text.ar) warn(s.id, `Scene ${n} has no Arabic text (Arabic viewers will see the English).`);
    if (hasText && !s.text.en) warn(s.id, `Scene ${n} has no English text (English viewers will see the Arabic).`);
    if (s.speaker && opts.characters && !people.has(s.speaker)) err(s.id, `Scene ${n}: its speaker was removed from the characters.`);

    if (s.musicRef && !beds.has(s.musicRef)) err(s.id, `Scene ${n} starts music "${s.musicRef}", but the episode has no music bed with that id.`);
    if ((s.sfx ?? []).length > LIMITS.sfxPerScene) err(s.id, `Scene ${n} has ${(s.sfx ?? []).length} sound effects; at most ${LIMITS.sfxPerScene}.`);
    if (s.voiceRef) {
      if (!s.speaker) err(s.id, `Scene ${n} has a voice line but no speaker (narrator scenes have no voice).`);
      else if (voices && !voices.has(s.speaker)) err(s.id, `Scene ${n}: ${s.speaker} has no locked voice in the series bible, so they can't have a voice line.`);
      if (!hasText) err(s.id, `Scene ${n} has a voice line but no text (the text is always shown on screen).`);
    }

    const r = s.route;
    if (r.type === "choices") {
      if (r.options.length < 1) err(s.id, `Scene ${n}: add at least one choice, or change it to "Continue".`);
      for (const c of r.options) {
        if (!c.label.ar && !c.label.en) err(s.id, `Scene ${n}: a choice has no text.`);
        if (c.to === s.id) err(s.id, `Scene ${n}: a choice leads back to the same scene.`);
      }
      if (r.options.length > 0 && r.options.every((c) => c.price > 0)) err(s.id, `Scene ${n}: every choice costs Ping. Keep one free choice so nobody gets stuck.`);
      // A choice has to change something: its own next scene, or at least what it remembers for later.
      const where = (to: string | null) => (to ? `scene ${g.scenes.findIndex((x) => x.id === to) + 1}` : "the end");
      const say = (c: (typeof r.options)[number]) => `"${c.label.en || c.label.ar || c.id}"`;
      const groups = new Map<string, typeof r.options>();
      for (const c of r.options) {
        const k = `${c.to ?? "∅"}|${c.sets ?? ""}`;
        groups.set(k, [...(groups.get(k) ?? []), c]);
      }
      for (const same of groups.values())
        if (same.length > 1)
          err(
            s.id,
            `Scene ${n}: ${same.map(say).join(" and ")} both go to ${where(same[0].to)} and change nothing. Give each choice its own next scene (or a different "Remember as" that a later scene reacts to).`,
          );
      const targets = new Set(r.options.map((c) => c.to ?? "∅"));
      if (r.options.length > 1 && targets.size === 1 && groups.size === r.options.length)
        warn(s.id, `Scene ${n}: every choice goes to ${where(r.options[0].to)}; the choice only matters where a later scene depends on what it remembers.`);
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
