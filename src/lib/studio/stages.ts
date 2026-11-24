// Studio production stages for a story episode, and who moves it where. Pure.
//
// brief ──Claude writes──► writing ──Claude submits──► script_review ──team approves──► pictures
//   ──Claude generates & attaches──► (submits) final_check ──team approves──► approved ──Publish──► published
// The team can send any review back with a note. Pictures are only made after the script is approved,
// so no OpenArt credits are spent on a script that gets rewritten.

export const STAGES = ["brief", "writing", "script_review", "pictures", "final_check", "approved", "published"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_INFO: Record<Stage, { label: string; hint: string; who: "claude" | "team" | "done" }> = {
  brief: { label: "Brief", hint: "Waiting for Claude to write it", who: "claude" },
  writing: { label: "Writing", hint: "Claude is writing or fixing the script", who: "claude" },
  script_review: { label: "Script review", hint: "Read the lines and routes; approve or send back", who: "team" },
  pictures: { label: "Pictures", hint: "Claude makes the pictures for the approved script", who: "claude" },
  final_check: { label: "Final check", hint: "Check pictures, play it in the preview, approve", who: "team" },
  approved: { label: "Ready", hint: "Approved; publish when you want it live", who: "team" },
  published: { label: "Published", hint: "Live for viewers", who: "done" },
};

export const isStage = (v: unknown): v is Stage => typeof v === "string" && (STAGES as readonly string[]).includes(v);

/** What Claude (through the Watchat connector) may do at each stage. */
export const claudeMay = {
  writeScript: (s: Stage) => s === "brief" || s === "writing",
  attachMedia: (s: Stage) => s === "pictures",
  submit: (s: Stage) => s === "brief" || s === "writing" || s === "pictures",
};

/** Where Claude's "submit for review" sends the episode. */
export const afterSubmit = (s: Stage): Stage | null => (s === "brief" || s === "writing" ? "script_review" : s === "pictures" ? "final_check" : null);

export type TeamMove = { to: Stage; label: string; kind: "approve" | "back" | "other"; needsNote?: boolean };

/** The buttons the team gets on an episode at each stage. */
export function teamMoves(s: Stage): TeamMove[] {
  switch (s) {
    case "brief":
      return [{ to: "writing", label: "Mark as being written", kind: "other" }];
    case "writing":
      return [{ to: "script_review", label: "Script is ready for review", kind: "other" }];
    case "script_review":
      return [
        { to: "pictures", label: "Approve script → make pictures", kind: "approve" },
        { to: "writing", label: "Send back to Claude", kind: "back", needsNote: true },
      ];
    case "pictures":
      return [{ to: "final_check", label: "Pictures are done", kind: "other" }];
    case "final_check":
      return [
        { to: "approved", label: "Approve episode", kind: "approve" },
        { to: "pictures", label: "Redo some pictures", kind: "back", needsNote: true },
        { to: "writing", label: "Rewrite the script", kind: "back", needsNote: true },
      ];
    case "approved":
      return [{ to: "final_check", label: "Back to final check", kind: "back" }];
    case "published":
      return [];
  }
}

export const canMove = (from: Stage, to: Stage) => teamMoves(from).some((m) => m.to === to);

export type Note = { at: string; by: string; who: "team" | "claude"; text: string; stage: Stage; open: boolean };

/** Add a note to an episode's thread (kept short; at most the last 100). */
export function addNote(notes: Note[], note: Omit<Note, "at" | "open"> & { at?: string }): Note[] {
  const text = note.text.trim().slice(0, 2000);
  if (!text) return notes;
  return [...notes, { ...note, text, at: note.at ?? new Date().toISOString(), open: note.who === "team" }].slice(-100);
}

/** Team notes Claude hasn't dealt with yet (closed when Claude submits again). */
export const openNotes = (notes: Note[]) => notes.filter((n) => n.open);
export const closeNotes = (notes: Note[]) => notes.map((n) => (n.open ? { ...n, open: false } : n));

export function sanitizeNotes(v: unknown): Note[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((n): n is Note => Boolean(n) && typeof n === "object" && typeof (n as Note).text === "string" && isStage((n as Note).stage))
    .map((n) => ({ at: String(n.at), by: String(n.by ?? "").slice(0, 100), who: n.who === "claude" ? "claude" : "team", text: n.text.slice(0, 2000), stage: n.stage, open: Boolean(n.open) }));
}
