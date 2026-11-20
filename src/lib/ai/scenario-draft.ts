// The scenario agent's contract: what it is told, the only format it may answer in, and the checks
// every draft passes before an admin can apply it. Pure functions, unit-tested in scenario-draft.test.ts.

import { COPY, COPY_KEYS, isCopyKey, type CopyKey } from "../bot/copy";
import { LIMITS } from "../whatsapp/messages";
import type { Tool } from "./anthropic";

export const MAX_CHAT_EPISODES = 5;
export const MAX_TEXT = 1000;

export type ScenarioSettings = { askLanguage: boolean; sendTrailer: boolean; askOptIn: boolean; waEpisodeCount: number };

export type ScenarioDraft = {
  summary: string;
  scenario: Partial<ScenarioSettings>;
  messages: { key: CopyKey; ar: string; en: string }[];
  notes: string;
};

export type DraftContext = {
  series: {
    code: string;
    titleAr: string;
    titleEn: string;
    synopsisAr: string | null;
    synopsisEn: string | null;
    dialect: string;
    episodeCount: number;
    hasTrailer: boolean;
  };
  scenario: ScenarioSettings;
  /** What each text says today for this series (custom or default). */
  texts: Record<CopyKey, { ar: string; en: string; custom: boolean }>;
};

export const SCENARIO_TOOL: Tool = {
  name: "propose_scenario",
  description: "Propose the WhatsApp chat scenario and bot texts for one series. Only include texts you change.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "2–4 short lines for the admin: what you changed and why. English." },
      scenario: {
        type: "object",
        properties: {
          askLanguage: { type: "boolean", description: "Ask Arabic vs English subtitles before anything else (W1)." },
          sendTrailer: { type: "boolean", description: "Send the trailer with a Start button before episode 1 (W2)." },
          askOptIn: { type: "boolean", description: "After the web link, ask whether to get new-episode alerts (W6)." },
          waEpisodeCount: { type: "integer", minimum: 0, maximum: MAX_CHAT_EPISODES, description: "Episodes sent inside WhatsApp before the web link." },
        },
        additionalProperties: false,
      },
      messages: {
        type: "array",
        description: "Only the texts you change. Give both Arabic and English for each.",
        items: {
          type: "object",
          properties: {
            key: { type: "string", enum: COPY_KEYS },
            ar: { type: "string" },
            en: { type: "string" },
          },
          required: ["key", "ar", "en"],
          additionalProperties: false,
        },
      },
      notes: {
        type: "string",
        description: "Anything asked for that this scenario can't do (e.g. timed reminders belong in Sequences), in English. Empty if none.",
      },
    },
    required: ["summary", "scenario", "messages", "notes"],
    additionalProperties: false,
  },
};

const PLACEHOLDER = /\{([a-zA-Z]+)\}/g;
const placeholdersIn = (s: string) => new Set(Array.from(s.matchAll(PLACEHOLDER), (m) => m[1]));

/** Placeholders a text may use: the ones its default text uses (the bot only fills those). */
export function allowedPlaceholders(key: CopyKey): Set<string> {
  return new Set([...placeholdersIn(COPY[key].ar), ...placeholdersIn(COPY[key].en)]);
}

export function systemPrompt(ctx: DraftContext): string {
  const s = ctx.series;
  const lines = COPY_KEYS.map((key) => {
    const e = COPY[key];
    const t = ctx.texts[key];
    const ph = [...allowedPlaceholders(key)].map((p) => `{${p}}`).join(" ") || "none";
    return [
      `- key: ${key} · ${e.label} · ${e.kind === "button" ? `BUTTON, max ${LIMITS.buttonTitle} characters` : `message, max ${MAX_TEXT} characters`} · placeholders: ${ph}`,
      `  ar: ${JSON.stringify(t.ar)}`,
      `  en: ${JSON.stringify(t.en)}`,
    ].join("\n");
  }).join("\n");

  return `You are the scenario designer for Watchat, an Arabic-first micro-drama service that starts inside WhatsApp.
A viewer sends a series code, gets a few short episodes in the chat, then a personal link to keep watching on the web.

How the chat runs (each step can be switched by the scenario settings):
W1 welcome + language question (askLanguage) → W2 trailer with Start (sendTrailer) → W3/W4 episodes in the chat (waEpisodeCount, each with a Next button, the last one ends on a cliffhanger) → W5 personal web link → W6 alerts question (askOptIn).
Other texts: W7 "not for me" (suggest another series), W12 menu, W13 device confirmation, W14 alerts stopped.

Series: ${s.code} · "${s.titleAr}" / "${s.titleEn}" · ${s.episodeCount} episodes · dialect: ${s.dialect} · trailer uploaded: ${s.hasTrailer ? "yes" : "no"}
Synopsis (ar): ${s.synopsisAr ?? "—"}
Synopsis (en): ${s.synopsisEn ?? "—"}
Current scenario: askLanguage=${ctx.scenario.askLanguage} sendTrailer=${ctx.scenario.sendTrailer} askOptIn=${ctx.scenario.askOptIn} waEpisodeCount=${ctx.scenario.waEpisodeCount}

Current texts for this series:
${lines}

Rules:
- Arabic is the main language: write natural ${s.dialect === "gulf" ? "Gulf" : s.dialect} Arabic, not a translation of the English. English is for viewers who chose English subtitles.
- Buttons: at most ${LIMITS.buttonTitle} characters, including emoji. Keep them short verbs.
- Use only the placeholders listed for each key, spelled exactly; never invent new ones. Don't hard-code the series title where {title} is available.
- Keep messages short and suspenseful: this is WhatsApp. No links, phone numbers, prices or promises you can't see above.
- Only include texts you actually change. Change the scenario settings only when the request asks for it.
- Don't send a trailer step when no trailer is uploaded; say so in notes instead.
- Timed reminders, follow-ups and broadcasts are not part of this scenario; they are set up in Sequences and Campaigns. Mention them in notes.
- The admin's request may be in Arabic or English. Answer through the propose_scenario tool only.`;
}

/** Check a draft from the model. Returns the cleaned draft plus problems (problems mean: ask the model again). */
export function validateDraft(raw: unknown, ctx: DraftContext): { draft: ScenarioDraft; problems: string[] } {
  const problems: string[] = [];
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const sc = (obj.scenario && typeof obj.scenario === "object" ? obj.scenario : {}) as Record<string, unknown>;

  const scenario: Partial<ScenarioSettings> = {};
  for (const k of ["askLanguage", "sendTrailer", "askOptIn"] as const) {
    if (typeof sc[k] === "boolean" && sc[k] !== ctx.scenario[k]) scenario[k] = sc[k] as boolean;
  }
  if (sc.waEpisodeCount !== undefined) {
    const n = sc.waEpisodeCount;
    const max = Math.min(MAX_CHAT_EPISODES, Math.max(ctx.series.episodeCount - 1, 0));
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > max) problems.push(`waEpisodeCount must be a whole number from 0 to ${max}.`);
    else if (n !== ctx.scenario.waEpisodeCount) scenario.waEpisodeCount = n;
  }
  if (scenario.sendTrailer === true && !ctx.series.hasTrailer) {
    problems.push("sendTrailer can't be true: no trailer is uploaded for this series. Leave it off and mention it in notes.");
    delete scenario.sendTrailer;
  }

  const messages: ScenarioDraft["messages"] = [];
  const seen = new Set<string>();
  for (const m of Array.isArray(obj.messages) ? obj.messages : []) {
    const { key, ar, en } = (m ?? {}) as Record<string, unknown>;
    if (typeof key !== "string" || !isCopyKey(key)) {
      problems.push(`Unknown text key ${JSON.stringify(key)}.`);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    const isButton = COPY[key].kind === "button";
    const max = isButton ? LIMITS.buttonTitle : MAX_TEXT;
    const allowed = allowedPlaceholders(key);
    let ok = true;
    for (const [lang, value] of [["ar", ar], ["en", en]] as const) {
      if (typeof value !== "string" || !value.trim()) {
        problems.push(`${key} (${lang}) is empty.`);
        ok = false;
        continue;
      }
      const len = Array.from(value.trim()).length;
      if (len > max) {
        problems.push(`${key} (${lang}) is ${len} characters; the limit is ${max}.`);
        ok = false;
      }
      const bad = [...placeholdersIn(value)].filter((p) => !allowed.has(p));
      if (bad.length) {
        problems.push(`${key} (${lang}) uses ${bad.map((p) => `{${p}}`).join(", ")}; allowed: ${[...allowed].map((p) => `{${p}}`).join(", ") || "none"}.`);
        ok = false;
      }
    }
    if (!ok) continue;
    const next = { key, ar: (ar as string).trim(), en: (en as string).trim() };
    const cur = ctx.texts[key];
    if (next.ar === cur.ar && next.en === cur.en) continue; // no change
    messages.push(next);
  }

  const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  return {
    draft: { summary: text(obj.summary, 1500), scenario, messages, notes: text(obj.notes, 1500) },
    problems,
  };
}

/** True when the draft would change nothing. */
export const isEmptyDraft = (d: ScenarioDraft) => d.messages.length === 0 && Object.keys(d.scenario).length === 0;
