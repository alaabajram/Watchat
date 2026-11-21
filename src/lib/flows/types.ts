// The flow format: what the visual builder saves and what the bot runs.
// Three kinds: a shared flow (one per brand: what the bot answers to words like ابدأ, رابط, حسابي, STOP),
// a series flow (one per series, starts at the Start card when the viewer sends the code) and a
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
  | { check: "paid_since" } // paid since this sequence started for them
  // Shared flow only:
  | { check: "has_series" }; // the viewer is following a series (so a player link can be sent)

/** What starts a sequence flow (the same moments as the sequences table). */
export type SequenceTrigger = "stopped_mid_series" | "inactive" | "finished_series";
export const SEQUENCE_TRIGGERS: { value: SequenceTrigger; label: string }[] = [
  { value: "stopped_mid_series", label: "Stopped in the middle of a series" },
  { value: "inactive", label: "Inactive (hasn't been back)" },
  { value: "finished_series", label: "Finished a series" },
];
export type FlowKind = "series" | "sequence" | "shared";

/** Built-in things a shared-flow Action card does (no message of its own). */
export type SharedAction = "opt_out" | "opt_in" | "delete_data";
export const SHARED_ACTIONS: { value: SharedAction; label: string; help: string }[] = [
  { value: "opt_out", label: "Turn alerts off", help: "Stops marketing messages for this viewer" },
  { value: "opt_in", label: "Turn alerts on", help: "The viewer agrees to new-episode messages" },
  { value: "delete_data", label: "Request data deletion", help: "Logs the request for the team and turns alerts off" },
];
export type ListRow = { id: string; title: Bi };

export type NodeData =
  | { kind: "start" }
  | { kind: "web" }
  | { kind: "message"; body: Bi; buttons: FlowButton[]; media: MediaRef | null }
  | { kind: "language"; body: Bi; btnAr: string; btnEn: string; skipIfKnown: boolean; media: MediaRef | null }
  // skipIfWatched: viewers who already watched this episode (chat or web) continue via the first button / Then.
  | { kind: "episode"; episode: number; caption: Bi; buttons: FlowButton[]; skipIfWatched: boolean }
  // resumeIfFurther: open where the viewer left off when that's past `episode`.
  | { kind: "link"; episode: number | "resume"; body: Bi; button: Bi; media: MediaRef | null; resumeIfFurther: boolean }
  | { kind: "optin"; body: Bi; yes: Bi; no: Bi; skipIfAnswered: boolean; media?: MediaRef | null }
  | { kind: "wait"; minutes: number }
  | { kind: "condition"; condition: Condition }
  // media: header picture for templates with an image header (default: the series' WhatsApp banner).
  | { kind: "template"; name: string; media?: MediaRef | null }
  // media: sent just before the list of series (a list message can't carry media itself).
  | { kind: "suggest"; media?: MediaRef | null }
  // Up to 3 series as buttons; tapping one starts that series' own flow. "AUTO" = a series the viewer hasn't started.
  | { kind: "choice"; body: Bi; options: ChoiceOption[]; media: MediaRef | null }
  // Sequence flows: where the sequence begins (the moment, how long after it, which series; null = any) and where it ends.
  | { kind: "trigger"; trigger: SequenceTrigger; delayHours: number; seriesCode: string | null }
  | { kind: "end" }
  // Shared flows: where a reply begins (the words a viewer sends; "anything else" catches what nothing matches),
  // a menu list (up to 10 rows, each its own port), a personal sign-in link to the account page, and built-in actions.
  | { kind: "keyword"; words: string[]; anythingElse: boolean }
  | { kind: "list"; body: Bi; button: Bi; section: Bi; rows: ListRow[]; media?: MediaRef | null }
  | { kind: "account"; body: Bi; button: Bi; media?: MediaRef | null }
  | { kind: "action"; action: SharedAction };

export const AUTO_SERIES = "AUTO";

/** Cards that can show a picture or video (every card that sends something). */
export const MEDIA_KINDS = ["message", "language", "link", "optin", "choice", "list", "account", "suggest", "template"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];
export const takesMedia = (d: NodeData): d is Extract<NodeData, { kind: MediaKind }> => (MEDIA_KINDS as readonly string[]).includes(d.kind);
/** Cards whose media must be an image (WhatsApp link buttons and template headers). */
export const IMAGE_ONLY_KINDS: NodeKind[] = ["link", "account", "template"];
/** Media of a card, if any. */
export const mediaOf = (d: NodeData): MediaRef | null => (takesMedia(d) ? (d.media ?? null) : null);
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
    case "list":
      return data.rows.length ? data.rows.map((r) => ({ id: r.id, label: r.title.ar || r.title.en || "Row" })) : [];
    case "suggest":
    case "choice":
    case "end":
      return [];
    default:
      return [{ id: "next", label: "Then" }];
  }
}

/** Entry cards: where a flow begins. Nothing can point into them. */
export const isEntry = (d: NodeData) => d.kind === "start" || d.kind === "web" || d.kind === "trigger" || d.kind === "keyword";

/** Cards that stop and wait for the viewer to tap a button. */
export const waitsForInput = (d: NodeData) =>
  ((d.kind === "message" || d.kind === "episode") && d.buttons.length > 0) || d.kind === "language" || d.kind === "optin" || (d.kind === "list" && d.rows.length > 0);

/** Cards that send a free-form message (only allowed within 24 h of the viewer's last message). */
export const isFreeform = (d: NodeData) => ["message", "language", "episode", "link", "optin", "suggest", "choice", "list", "account"].includes(d.kind);

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
  keyword: "Viewer sends",
  list: "Menu list",
  account: "My account link",
  action: "Action",
};

/** Cards that can be added to a sequence flow (all business-initiated: templates only). */
export const SEQUENCE_CARDS: NodeKind[] = ["trigger", "wait", "condition", "template", "end"];
/** Checks offered on a Condition card in each kind of flow. */
export const SEQUENCE_CHECKS: Condition["check"][] = ["came_back", "paid_since", "opted_in", "language_en", "paid", "watched_within"];

/** Cards that can be added to the shared flow (replies inside the viewer's 24 h window, no waits or templates). */
export const SHARED_CARDS: NodeKind[] = ["keyword", "message", "list", "link", "account", "language", "optin", "condition", "action", "suggest", "choice"];
export const SHARED_CHECKS: Condition["check"][] = ["has_series", "opted_in", "language_en", "paid"];

/** Normalise what a viewer typed for keyword matching: Western digits, upper case, letters and digits only. */
export function normaliseWord(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

export const BUTTON_ID_PREFIX = "f:";
/** Buttons and rows sent by the shared flow: "s:<node>:<port>" (series flows use "f:"). */
export const SHARED_ID_PREFIX = "s:";
export const sharedReplyId = (nodeId: string, port: string) => `${SHARED_ID_PREFIX}${nodeId}:${port}`;
export function parseSharedReplyId(id: string): { nodeId: string; port: string } | null {
  if (!id.startsWith(SHARED_ID_PREFIX)) return null;
  const [nodeId, port] = id.slice(SHARED_ID_PREFIX.length).split(":");
  return nodeId && port ? { nodeId, port } : null;
}
/** Same id the bot already uses for "pick a series" (IDS.seriesPrefix): a tap starts that series. */
export const SERIES_BUTTON_PREFIX = "series:";
export const buttonReplyId = (nodeId: string, port: string) => `${BUTTON_ID_PREFIX}${nodeId}:${port}`;
export function parseButtonReplyId(id: string): { nodeId: string; port: string } | null {
  if (!id.startsWith(BUTTON_ID_PREFIX)) return null;
  const [nodeId, port] = id.slice(BUTTON_ID_PREFIX.length).split(":");
  return nodeId && port ? { nodeId, port } : null;
}
