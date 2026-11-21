// The shared flow (Flow builder → Shared replies): what the bot answers to words a viewer sends outside a
// series' chat, built on the canvas like any flow. Pure: used by the bot, the builder and the tests.
//
// The standard shared flow rebuilds the bot's built-in replies as cards (menu, player link, my account,
// alerts off, data deletion, anything else → menu), with the team's saved Shared reply texts as the start.

import { COPY, type CopyKey } from "../bot/copy";
import { normaliseWord, type Bi, type FlowEdge, type FlowGraph, type FlowNode, type NodeData } from "./types";

/** Text for a copy key: the team's saved override, else the built-in default. */
export type TextOf = (key: CopyKey) => Bi;
export const defaultText: TextOf = (key) => ({ ar: COPY[key].ar, en: COPY[key].en });

export const MENU_WORDS = ["ابدأ", "القائمة", "مساعدة", "START", "MENU", "HELP"];
export const LINK_WORDS = ["رابط", "رابطي", "LINK"];
export const ACCOUNT_WORDS = ["حسابي", "دخول", "ACCOUNT", "LOGIN"];
export const STOP_WORDS = ["إيقاف", "توقف", "STOP", "UNSUBSCRIBE"];
export const DELETE_WORDS = ["احذف بياناتي", "DELETE MY DATA"];

/** The standard shared flow: the bot's built-in replies as editable cards. */
export function standardSharedFlow(t: TextOf = defaultText): FlowGraph {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const add = (id: string, x: number, y: number, data: NodeData, name?: string) => nodes.push({ id, position: { x, y }, data, ...(name ? { name } : {}) });
  const link = (source: string, sourceHandle: string, target: string) => edges.push({ id: `e_${source}_${sourceHandle}`, source, sourceHandle, target });
  const X = [0, 360, 740, 1120];

  // Menu, and "anything else" lands on it too.
  add("k_menu", X[0], 0, { kind: "keyword", words: MENU_WORDS, anythingElse: false }, "Menu words");
  add("k_else", X[0], 230, { kind: "keyword", words: [], anythingElse: true }, "Anything else");
  add("menu", X[1], 0, {
    kind: "list",
    body: t("menuBody"),
    button: t("btnMenu"),
    section: t("menuSectionTitle"),
    rows: [
      { id: "link", title: t("menuLink") },
      { id: "lang", title: t("menuLanguage") },
      { id: "alerts", title: t("menuAlerts") },
      { id: "support", title: t("menuSupport") },
    ],
  }, "Menu");
  link("k_menu", "next", "menu");
  link("k_else", "next", "menu");

  // Player link: needs a series; otherwise the account link.
  add("k_link", X[0], 470, { kind: "keyword", words: LINK_WORDS, anythingElse: false }, "Link words");
  add("has_series", X[2], -120, { kind: "condition", condition: { check: "has_series" } }, "Following a series?");
  add("player", X[3], -200, { kind: "link", episode: "resume", body: t("linkBody"), button: t("btnOpenPlayer"), media: null, resumeIfFurther: true }, "Player link");
  link("menu", "link", "has_series");
  link("k_link", "next", "has_series");
  link("has_series", "yes", "player");

  // Account
  add("k_account", X[0], 700, { kind: "keyword", words: ACCOUNT_WORDS, anythingElse: false }, "Account words");
  add("account", X[3], 40, { kind: "account", body: t("accountBody"), button: t("btnMyAccount") }, "My account");
  link("k_account", "next", "account");
  link("has_series", "no", "account");

  // Language, alerts, support
  add("language", X[2], 130, { kind: "language", body: t("welcomeAskLanguage"), btnAr: t("btnArabic").ar, btnEn: t("btnEnglishSubs").ar, skipIfKnown: false, media: null }, "Change language");
  link("menu", "lang", "language");
  add("alerts_on", X[2], 420, { kind: "condition", condition: { check: "opted_in" } }, "Alerts on?");
  link("menu", "alerts", "alerts_on");
  add("ask", X[3], 300, { kind: "optin", body: t("optInBody"), yes: t("btnYesNotify"), no: t("btnNoThanks"), skipIfAnswered: false }, "Alerts question");
  add("declined", X[3] + 380, 420, { kind: "message", body: t("optInDeclined"), buttons: [], media: null }, "Alerts declined");
  add("confirmed", X[3] + 380, 200, { kind: "message", body: t("optInConfirmed"), buttons: [], media: null }, "Alerts on");
  link("alerts_on", "no", "ask");
  link("ask", "yes", "confirmed");
  link("ask", "no", "declined");
  add("support", X[2], 640, { kind: "message", body: t("supportBody"), buttons: [], media: null }, "Support");
  link("menu", "support", "support");

  // STOP → alerts off, with a button to turn them back on
  add("k_stop", X[0], 930, { kind: "keyword", words: STOP_WORDS, anythingElse: false }, "STOP words");
  add("opt_out", X[2], 900, { kind: "action", action: "opt_out" }, "Alerts off");
  add("stopped", X[3], 860, { kind: "message", body: t("stopConfirmed"), buttons: [{ id: "on", title: t("btnAlertsOn") }], media: null }, "Alerts off reply");
  add("opt_in", X[3] + 380, 860, { kind: "action", action: "opt_in" }, "Alerts back on");
  link("k_stop", "next", "opt_out");
  link("alerts_on", "yes", "opt_out");
  link("opt_out", "next", "stopped");
  link("stopped", "on", "opt_in");
  link("opt_in", "next", "confirmed");

  // Data deletion
  add("k_delete", X[0], 1160, { kind: "keyword", words: DELETE_WORDS, anythingElse: false }, "Delete words");
  add("delete", X[2], 1140, { kind: "action", action: "delete_data" }, "Data deletion");
  add("deleted", X[3], 1120, { kind: "message", body: t("deleteRequested"), buttons: [], media: null }, "Deletion reply");
  link("k_delete", "next", "delete");
  link("delete", "next", "deleted");

  return { v: 1, nodes, edges };
}

/** The "Viewer sends" card a message starts: an exact word match first, then the "anything else" card. */
export function matchKeyword(g: FlowGraph, text: string, opts: { allowCatchAll: boolean }): FlowNode | null {
  const word = normaliseWord(text);
  if (word) {
    for (const n of g.nodes) {
      if (n.data.kind === "keyword" && n.data.words.some((w) => normaliseWord(w) === word)) return n;
    }
  }
  if (!opts.allowCatchAll) return null;
  return g.nodes.find((n) => n.data.kind === "keyword" && n.data.anythingElse) ?? null;
}
