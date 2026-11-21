// The flow format: what the visual builder saves and what the bot runs.
// Two kinds: a series flow (one per series, starts at the Start card when the viewer sends the code) and a
// sequence flow (starts at a Trigger card when a viewer reaches a moment, e.g. stopped mid-series; template-only). Cards (nodes) are linked by arrows (edges) from a card's port to the next card.
// Ports: "next" for cards without choices; one port per button; "ar"/"en", "yes"/"no" for built-in choices.
// Pure types only: imported by the server engine and by the browser editor and preview.

export type Lang = "ar" | "en";
export type Bi = { ar: string; en: string };

/** Artwork sizes kept on the series in the CMS (the WhatsApp banner falls back to the poster). */
export type ArtSlot = "poster" | "banner_wa" | "banner_wide" | "square";

export type MediaRef =
  | { assetId: string; url: string; type: "image" | "video"; name?: string } // media library upload
  | { source: "poster" | "trailer"; type: "image" | "video" } // series poster / trailer
  | { source: "series"; slot: ArtSlot; type: "image" } // series artwork from the CMS
  | { source: "episode"; episode: number; type: "video" }; // an episode's WhatsApp clip from the CMS

export type FlowButton = { id: string; title: Bi };

export type Condition =
  | { check: "opted_in" }
  | { check: "language_en" }
  | { check: "paid" }
  | { check: "reached_episode"; episode: number }
  | { check: "started" } // watched any episode of this series (chat or web)
  | { check: "watched_within"; hours: number } // watched this series on the web in the last N hours
  // Sequence flows only:
  | { check: "came_back" } // active again (chat or web) since this sequence started for them
  | { check: "paid_since" }; // paid since this sequence started for them

/** What starts a sequence flow (the same moments as the sequences table). */
export type SequenceTrigger = "stopped_mid_series" | "inactive" | "finished_series";
export const SEQUENCE_TRIGGERS: { value: SequenceTrigger; label: string }[] = [
  { value: "stopped_mid_series", label: "Stopped in the middle of a series" },
  { value: "inactive", label: "Inactive (hasn't been back)" },
  { value: "finished_series", label: "Finished a series" },
];
export type FlowKind = "series" | "sequence";

export type NodeData =
  | { kind: "start" }
  | { kind: "web" }
  | { kind: "message"; body: Bi; buttons: FlowButton[]; media: MediaRef | null }
  | { kind: "language"; body: Bi; btnAr: string; btnEn: string; skipIfKnown: boolean; media: MediaRef | null }
  // skipIfWatched: viewers who already watched this episode (chat or web) continue via the first button / Then.
  | { kind: "episode"; episode: number; caption: Bi; buttons: FlowButton[]; skipIfWatched: boolean }
  // resumeIfFurther: open where the viewer left off when that's past `episode`.
  | { kind: "link"; episode: number | "resume"; body: Bi; button: Bi; media: MediaRef | null; resumeIfFurther: boolean }
  | { kind: "optin"; body: Bi; yes: Bi; no: Bi; skipIfAnswered: boolean }
  | { kind: "wait"; minutes: number }
  | { kind: "condition"; condition: Condition }
  | { kind: "template"; name: string }
  | { kind: "suggest" }
  // Up to 3 series as buttons; tapping one starts that series' own flow. "AUTO" = a series the viewer hasn't started.
  | { kind: "choice"; body: Bi; options: ChoiceOption[]; media: MediaRef | null }
  // Sequence flows: where the sequence begins (the moment, how long after it, which series; null = any) and where it ends.
  | { kind: "trigger"; trigger: SequenceTrigger; delayHours: number; seriesCode: string | null }
  | { kind: "end" };

export const AUTO_SERIES = "AUTO";
export type ChoiceOption = { code: string; label: Bi };

export type NodeKind = NodeData["kind"];

/** `name` is an optional label the team gives a card (shown on the canvas), e.g. "Hook after episode 2". */
export type FlowNode = { id: string; position: { x: number; y: number }; data: NodeData; name?: string };
export type FlowEdge = { id: string; source: string; sourceHandle: string; target: string };
export type FlowGraph = { v: 1; nodes: FlowNode[]; edges: FlowEdge[] };

/** Ports a card offers, in display order, with their labels. */
export function portsOf(data: NodeData): { id: string; label: string }[] {
  switch (data.kind) {
    case "message":
      return data.buttons.length ? data.buttons.map((b) => ({ id: b.id, label: b.title.ar || b.title.en || "Button" })) : [{ id: "next", label: "Then" }];
    case "episode":
      return data.buttons.length ? data.buttons.map((b) => ({ id: b.id, label: b.title.ar || b.title.en || "Button" })) : [{ id: "next", label: "Then" }];
    case "language":
      return [
        { id: "ar", label: data.btnAr || "Arabic" },
        { id: "en", label: data.btnEn || "English" },
      ];
    case "optin":
      return [
        { id: "yes", label: data.yes.ar || "Yes" },
        { id: "no", label: data.no.ar || "No" },
      ];
    case "condition":
      return [
        { id: "yes", label: "Yes" },
        { id: "no", label: "No" },
      ];
    case "suggest":
    case "choice":
    case "end":
      return [];
    default:
      return [{ id: "next", label: "Then" }];
  }
}

/** Entry cards: where a flow begins. Nothing can point into them. */
export const isEntry = (d: NodeData) => d.kind === "start" || d.kind === "web" || d.kind === "trigger";

/** Cards that stop and wait for the viewer to tap a button. */
export const waitsForInput = (d: NodeData) =>
  ((d.kind === "message" || d.kind === "episode") && d.buttons.length > 0) || d.kind === "language" || d.kind === "optin";

/** Cards that send a free-form message (only allowed within 24 h of the viewer's last message). */
export const isFreeform = (d: NodeData) => ["message", "language", "episode", "link", "optin", "suggest", "choice"].includes(d.kind);

export const CARD_LABELS: Record<NodeKind, string> = {
  start: "Start: viewer sends the series code",
  web: "On the web: viewer starts watching",
  message: "Message",
  language: "Ask language",
  episode: "Episode in chat",
  link: "Web link",
  optin: "Ask for alerts",
  wait: "Wait",
  condition: "Condition",
  template: "Template (after 24 h)",
  suggest: "Suggest other series",
  choice: "Series choice (3 titles)",
  trigger: "Trigger: when the sequence starts",
  end: "End sequence",
};

/** Cards that can be added to a sequence flow (all business-initiated: templates only). */
export const SEQUENCE_CARDS: NodeKind[] = ["trigger", "wait", "condition", "template", "end"];
/** Checks offered on a Condition card in each kind of flow. */
export const SEQUENCE_CHECKS: Condition["check"][] = ["came_back", "paid_since", "opted_in", "language_en", "paid", "watched_within"];

export const BUTTON_ID_PREFIX = "f:";
/** Same id the bot already uses for "pick a series" (IDS.seriesPrefix): a tap starts that series. */
export const SERIES_BUTTON_PREFIX = "series:";
export const buttonReplyId = (nodeId: string, port: string) => `${BUTTON_ID_PREFIX}${nodeId}:${port}`;
export function parseButtonReplyId(id: string): { nodeId: string; port: string } | null {
  if (!id.startsWith(BUTTON_ID_PREFIX)) return null;
  const [nodeId, port] = id.slice(BUTTON_ID_PREFIX.length).split(":");
  return nodeId && port ? { nodeId, port } : null;
}
