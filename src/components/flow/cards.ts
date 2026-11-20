// Card catalogue for the builder: icon, colour, short help, and the starting content of a new card.

import { COPY } from "@/lib/bot/copy";
import { newId } from "@/lib/flows/defaults";
import type { NodeData, NodeKind } from "@/lib/flows/types";

export const CARD_STYLE: Record<NodeKind, { icon: string; color: string; help: string }> = {
  start: { icon: "▶", color: "#0f766e", help: "Where every chat begins: the viewer sends the series code (from an ad, a link, or typed)." },
  web: {
    icon: "🌐",
    color: "#0e7490",
    help: "Starts when the viewer begins watching this series on the web (at most once every 6 hours). Use it for follow-ups: e.g. Wait 2 h → Condition 'watched in the last 2 hours' → reminder. Other series' waiting follow-ups pause.",
  },
  message: { icon: "💬", color: "#2563eb", help: "Text, image or video, with up to 3 buttons. Each button can lead somewhere different." },
  language: { icon: "🌐", color: "#7c3aed", help: "Arabic or English subtitles. Skipped automatically for viewers who already chose." },
  episode: { icon: "🎬", color: "#db2777", help: "Sends an episode's chat clip (uploaded on the series page) with its caption." },
  link: { icon: "🔗", color: "#ea580c", help: "The viewer's personal web player link to an episode. Signs them in silently." },
  optin: { icon: "🔔", color: "#ca8a04", help: "Asks for new-episode alerts. Needed before any marketing template." },
  wait: { icon: "⏱", color: "#475569", help: "Pauses the flow. After 23 h or more, only Template cards may follow." },
  condition: { icon: "🔀", color: "#0891b2", help: "Splits the flow by what the viewer has done: Yes / No." },
  template: { icon: "📄", color: "#16a34a", help: "A Meta-approved template: the only message allowed 24 h after the viewer's last message." },
  suggest: { icon: "📚", color: "#9333ea", help: "Sends the list of other series. Ends this flow." },
  choice: {
    icon: "🎞️",
    color: "#be185d",
    help: "One message with up to 3 series as buttons. Tapping one starts that series' own flow (from where the viewer is in it). 'Recommended' picks a live series the viewer hasn't started.",
  },
};

export const ADDABLE: NodeKind[] = ["message", "episode", "link", "language", "optin", "wait", "condition", "template", "choice", "suggest", "web"];

const bi = (k: keyof typeof COPY) => ({ ar: COPY[k].ar, en: COPY[k].en });

export function newCard(kind: NodeKind, episodeCount: number): NodeData {
  switch (kind) {
    case "message":
      return { kind, body: { ar: "", en: "" }, buttons: [], media: null };
    case "language":
      return { kind, body: bi("welcomeAskLanguage"), btnAr: COPY.btnArabic.ar, btnEn: COPY.btnEnglishSubs.ar, skipIfKnown: true, media: null };
    case "episode":
      return {
        kind,
        episode: 1,
        skipIfWatched: true,
        caption: bi("episodeCaption"),
        buttons: [
          { id: newId(), title: bi("btnNext") },
          { id: newId(), title: bi("btnNotForMe") },
        ],
      };
    case "link":
      return { kind, episode: Math.min(4, Math.max(episodeCount, 1)), body: bi("cliffhangerBody"), button: bi("btnWatchEp"), media: { source: "poster", type: "image" }, resumeIfFurther: true };
    case "optin":
      return { kind, body: bi("optInBody"), yes: bi("btnYesNotify"), no: bi("btnNoThanks"), skipIfAnswered: true };
    case "wait":
      return { kind, minutes: 120 };
    case "condition":
      return { kind, condition: { check: "opted_in" } };
    case "template":
      return { kind, name: "" };
    case "suggest":
      return { kind };
    case "choice":
      return {
        kind,
        body: { ar: "شو تحب تشوف بعدها؟ 🍿 اختر مسلسلك:", en: "What do you want to watch next? 🍿 Pick a series:" },
        options: [0, 1, 2].map(() => ({ code: "AUTO", label: { ar: "", en: "" } })),
        media: null,
      };
    case "start":
    case "web":
      return { kind };
  }
}
