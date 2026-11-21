// The Shared replies canvas: what a viewer sends (or taps) and what the bot answers, drawn as cards.
// Pure data, used by the admin canvas. The bot's behaviour itself lives in flow.ts; this map mirrors it
// so every shared text sits next to the moment it is sent. Each SHARED key appears on exactly one card
// (checked in shared-map.test.ts) except the retired ones listed in RETIRED_KEYS.

import { COPY, SHARED_KEYS, type CopyKey } from "./copy";

/** How a text piece shows inside the WhatsApp bubble. */
export type PieceRole = "body" | "button" | "list_button" | "section" | "row" | "note";

export type Piece = { key: CopyKey; role: PieceRole; /** this button/row leads to another card */ to?: string };

export type MomentCard =
  | {
      id: string;
      kind: "viewer";
      /** What the viewer does, in plain words (shown as their chat bubble). */
      says: { ar: string; en: string };
      hint?: string;
      to: string;
      x: number;
      y: number;
    }
  | {
      id: string;
      kind: "reply";
      title: string;
      /** When it is sent, in a short line for the team. */
      when: string;
      pieces: Piece[];
      /** Where the bot goes after sending (no button involved), e.g. "then the menu". */
      then?: string;
      /** A card whose text is sometimes added to this reply (drawn as a dashed link). */
      adds?: string;
      x: number;
      y: number;
    };

// Device confirmation codes are no longer asked for (spending needs no confirmation since Nov 2026).
export const RETIRED_KEYS: CopyKey[] = ["confirmOk", "confirmFailed"];

const COL = { viewer: 0, reply: 330, next: 700, last: 1070 };

export const SHARED_MAP: MomentCard[] = [
  // ── Menu and what it leads to ──────────────────────────────────────────────
  {
    id: "v-menu",
    kind: "viewer",
    says: { ar: "ابدأ · القائمة · مساعدة", en: "START · MENU · HELP" },
    hint: "Also the watchat.pro start button, and anything the bot doesn't understand",
    to: "r-menu",
    x: COL.viewer,
    y: 0,
  },
  {
    id: "r-menu",
    kind: "reply",
    title: "Menu",
    when: "After a menu word or anything unclear",
    pieces: [
      { key: "menuBody", role: "body" },
      { key: "btnMenu", role: "list_button" },
      { key: "menuSectionTitle", role: "section" },
      { key: "menuLink", role: "row", to: "r-link" },
      { key: "menuLanguage", role: "row", to: "r-language" },
      { key: "menuAlerts", role: "row", to: "r-optin" },
      { key: "menuSupport", role: "row", to: "r-support" },
    ],
    x: COL.reply,
    y: 0,
  },
  {
    id: "v-unclear",
    kind: "viewer",
    says: { ar: "رسالة غير مفهومة", en: "Something unclear" },
    hint: "Before they've started any series",
    to: "r-no-series",
    x: COL.viewer,
    y: 420,
  },
  {
    id: "r-no-series",
    kind: "reply",
    title: "No series yet",
    when: "Unclear message from someone with no series",
    pieces: [{ key: "needSeriesFirst", role: "body" }],
    then: "Then the menu",
    x: COL.reply,
    y: 420,
  },
  {
    id: "v-link",
    kind: "viewer",
    says: { ar: "رابط", en: "LINK" },
    hint: "Or the menu's “My player link”",
    to: "r-link",
    x: COL.viewer,
    y: -200,
  },
  {
    id: "r-link",
    kind: "reply",
    title: "Player link",
    when: "Link to where they stopped in their current series",
    pieces: [
      { key: "linkBody", role: "body" },
      { key: "btnOpenPlayer", role: "button" },
    ],
    then: "No series yet → the My account reply instead",
    x: COL.next,
    y: -200,
  },
  {
    id: "r-language",
    kind: "reply",
    title: "Change language",
    when: "From the menu (same as the first welcome)",
    pieces: [
      { key: "welcomeAskLanguage", role: "body" },
      { key: "btnArabic", role: "button" },
      { key: "btnEnglishSubs", role: "button" },
    ],
    x: COL.next,
    y: 90,
  },
  {
    id: "r-optin",
    kind: "reply",
    title: "Alerts question",
    when: "Menu “Alerts on/off” when alerts are off",
    pieces: [
      { key: "optInBody", role: "body" },
      { key: "btnYesNotify", role: "button", to: "r-optin-yes" },
      { key: "btnNoThanks", role: "button", to: "r-optin-no" },
    ],
    then: "Alerts already on → the Alerts off reply",
    x: COL.next,
    y: 460,
  },
  {
    id: "r-support",
    kind: "reply",
    title: "Support",
    when: "Menu “Talk to support”",
    pieces: [{ key: "supportBody", role: "body" }],
    x: COL.next,
    y: 790,
  },
  {
    id: "r-optin-yes",
    kind: "reply",
    title: "Alerts on",
    when: "Viewer said yes to alerts",
    pieces: [{ key: "optInConfirmed", role: "body" }],
    x: COL.last,
    y: 400,
  },
  {
    id: "r-optin-no",
    kind: "reply",
    title: "Alerts declined",
    when: "Viewer said no thanks",
    pieces: [{ key: "optInDeclined", role: "body" }],
    x: COL.last,
    y: 640,
  },

  // ── Account and pinning ────────────────────────────────────────────────────
  {
    id: "v-account",
    kind: "viewer",
    says: { ar: "حسابي", en: "MY ACCOUNT" },
    hint: "Also sent from watchat.pro/me on a phone that isn't signed in",
    to: "r-account",
    x: COL.viewer,
    y: 660,
  },
  {
    id: "r-account",
    kind: "reply",
    title: "My account",
    when: "Personal sign-in link to watchat.pro/me",
    pieces: [
      { key: "accountBody", role: "body" },
      { key: "btnMyAccount", role: "button" },
    ],
    adds: "r-pin",
    x: COL.reply,
    y: 660,
  },
  {
    id: "r-pin",
    kind: "reply",
    title: "Pin tip",
    when: "Added once, under a viewer's very first personal link",
    pieces: [{ key: "pinHint", role: "note" }],
    x: COL.last,
    y: 860,
  },

  // ── Alerts off, data deletion ──────────────────────────────────────────────
  {
    id: "v-stop",
    kind: "viewer",
    says: { ar: "إيقاف", en: "STOP" },
    hint: "Or the menu's “Alerts on/off” when alerts are on",
    to: "r-stop",
    x: COL.viewer,
    y: 920,
  },
  {
    id: "r-stop",
    kind: "reply",
    title: "Alerts off",
    when: "Marketing messages stop right away",
    pieces: [
      { key: "stopConfirmed", role: "body" },
      { key: "btnAlertsOn", role: "button", to: "r-optin-yes" },
    ],
    x: COL.reply,
    y: 920,
  },
  {
    id: "v-delete",
    kind: "viewer",
    says: { ar: "احذف بياناتي", en: "DELETE MY DATA" },
    to: "r-delete",
    x: COL.viewer,
    y: 1160,
  },
  {
    id: "r-delete",
    kind: "reply",
    title: "Data deletion",
    when: "Logged for the team; alerts stop",
    pieces: [{ key: "deleteRequested", role: "body" }],
    x: COL.reply,
    y: 1160,
  },

  // ── Discovering other series ───────────────────────────────────────────────
  {
    id: "v-nfm",
    kind: "viewer",
    says: { ar: "ما يناسبني", en: "Not for me" },
    hint: "Tapped under a trailer or an episode",
    to: "r-nfm",
    x: COL.viewer,
    y: 1400,
  },
  {
    id: "r-nfm",
    kind: "reply",
    title: "Other series",
    when: "List of the other live series",
    pieces: [
      { key: "notForMeBody", role: "body" },
      { key: "btnSeeSeries", role: "list_button" },
      { key: "seriesSectionTitle", role: "section" },
    ],
    then: "No other series → the reply below",
    x: COL.reply,
    y: 1400,
  },
  {
    id: "r-no-other",
    kind: "reply",
    title: "No other series",
    when: "Nothing else is live yet",
    pieces: [{ key: "noOtherSeries", role: "body" }],
    x: COL.next,
    y: 1400,
  },
  {
    id: "v-picks",
    kind: "viewer",
    says: { ar: "شوف اختياراتي", en: "See my picks" },
    hint: "Tapped on a growth agent message",
    to: "r-picks",
    x: COL.viewer,
    y: 1680,
  },
  {
    id: "r-picks",
    kind: "reply",
    title: "Your picks",
    when: "Up to 3 series chosen by the growth agent",
    pieces: [{ key: "picksBody", role: "body" }],
    x: COL.reply,
    y: 1680,
  },
  {
    id: "v-badcode",
    kind: "viewer",
    says: { ar: "كود غير موجود", en: "A code we don't have" },
    hint: "e.g. a typo in the code from the ad",
    to: "r-badcode",
    x: COL.viewer,
    y: 1900,
  },
  {
    id: "r-badcode",
    kind: "reply",
    title: "Unknown code",
    when: "The series code doesn't match a live series",
    pieces: [{ key: "seriesNotFound", role: "body" }],
    x: COL.reply,
    y: 1900,
  },
];

/** Shared keys shown on the canvas (everything except retired texts). */
export const CANVAS_KEYS: CopyKey[] = SHARED_KEYS.filter((k) => !RETIRED_KEYS.includes(k));

export function maxLength(key: CopyKey): number {
  return COPY[key].kind === "button" ? 20 : 1000;
}

/** Edges for the canvas: viewer → reply, and button/row → the card it leads to. */
export type MapEdge = { id: string; source: string; sourceHandle: string; target: string; adds?: true };

export function mapEdges(map: MomentCard[] = SHARED_MAP): MapEdge[] {
  const out: MapEdge[] = [];
  for (const c of map) {
    if (c.kind === "viewer") out.push({ id: `${c.id}->${c.to}`, source: c.id, sourceHandle: "out", target: c.to });
    else {
      for (const p of c.pieces) if (p.to) out.push({ id: `${c.id}:${p.key}->${p.to}`, source: c.id, sourceHandle: p.key, target: p.to });
      if (c.adds) out.push({ id: `${c.id}+${c.adds}`, source: c.id, sourceHandle: "adds", target: c.adds, adds: true });
    }
  }
  return out;
}
