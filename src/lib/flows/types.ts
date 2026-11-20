// The flow format: what the visual builder saves and what the bot runs.
// One flow per series. Cards (nodes) are linked by arrows (edges) from a card's port to the next card.
// Ports: "next" for cards without choices; one port per button; "ar"/"en", "yes"/"no" for built-in choices.
// Pure types only: imported by the server engine and by the browser editor and preview.

export type Lang = "ar" | "en";
export type Bi = { ar: string; en: string };

export type MediaRef = { assetId: string; url: string; type: "image" | "video"; name?: string } | { source: "poster" | "trailer"; type: "image" | "video" };

export type FlowButton = { id: string; title: Bi };

export type Condition =
  | { check: "opted_in" }
  | { check: "language_en" }
  | { check: "paid" }
  | { check: "reached_episode"; episode: number };

export type NodeData =
  | { kind: "start" }
  | { kind: "message"; body: Bi; buttons: FlowButton[]; media: MediaRef | null }
  | { kind: "language"; body: Bi; btnAr: string; btnEn: string; skipIfKnown: boolean; media: MediaRef | null }
  | { kind: "episode"; episode: number; caption: Bi; buttons: FlowButton[] }
  | { kind: "link"; episode: number | "resume"; body: Bi; button: Bi; media: MediaRef | null }
  | { kind: "optin"; body: Bi; yes: Bi; no: Bi; skipIfAnswered: boolean }
  | { kind: "wait"; minutes: number }
  | { kind: "condition"; condition: Condition }
  | { kind: "template"; name: string }
  | { kind: "suggest" };

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
      return [];
    default:
      return [{ id: "next", label: "Then" }];
  }
}

/** Cards that stop and wait for the viewer to tap a button. */
export const waitsForInput = (d: NodeData) =>
  ((d.kind === "message" || d.kind === "episode") && d.buttons.length > 0) || d.kind === "language" || d.kind === "optin";

/** Cards that send a free-form message (only allowed within 24 h of the viewer's last message). */
export const isFreeform = (d: NodeData) => ["message", "language", "episode", "link", "optin", "suggest"].includes(d.kind);

export const CARD_LABELS: Record<NodeKind, string> = {
  start: "Start: viewer sends the series code",
  message: "Message",
  language: "Ask language",
  episode: "Episode in chat",
  link: "Web link",
  optin: "Ask for alerts",
  wait: "Wait",
  condition: "Condition",
  template: "Template (after 24 h)",
  suggest: "Suggest other series",
};

export const BUTTON_ID_PREFIX = "f:";
export const buttonReplyId = (nodeId: string, port: string) => `${BUTTON_ID_PREFIX}${nodeId}:${port}`;
export function parseButtonReplyId(id: string): { nodeId: string; port: string } | null {
  if (!id.startsWith(BUTTON_ID_PREFIX)) return null;
  const [nodeId, port] = id.slice(BUTTON_ID_PREFIX.length).split(":");
  return nodeId && port ? { nodeId, port } : null;
}
