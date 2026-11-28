// Rooms engine (pure; runs on the server and in the browser). A room is configuration — a mechanic, texts,
// costs and a schedule of daily rounds — so the team can add room #7 … #50 from Admin → Rooms without code.
// The mechanics are the only fixed part: each one says how many options a round has, whether one of them is
// "right", and what the viewer sees after answering.

export type Mechanic = "poll" | "would_you_rather" | "opinion" | "hot_seat" | "liar" | "guess" | "debate";

export type MechanicSpec = {
  key: Mechanic;
  label: string;
  hint: string;
  minOptions: number;
  maxOptions: number;
  /** One option is the right answer (liar: the lie; guess: the answer). */
  oneCorrect: boolean;
  /** Each option can carry a reveal text shown after answering (hot seat: the guest's answer). */
  reveals: boolean;
  /** The round shows clues before the options (guess). */
  clues: boolean;
};

export const MECHANICS: Record<Mechanic, MechanicSpec> = {
  poll: { key: "poll", label: "Poll", hint: "A question with 2–6 answers; viewers see how everyone voted.", minOptions: 2, maxOptions: 6, oneCorrect: false, reveals: false, clues: false },
  would_you_rather: { key: "would_you_rather", label: "Would you rather", hint: "Two choices; pick one, see the split.", minOptions: 2, maxOptions: 2, oneCorrect: false, reveals: false, clues: false },
  opinion: { key: "opinion", label: "Opinion scale", hint: "A bold statement; viewers rate it from strongly disagree to strongly agree.", minOptions: 0, maxOptions: 0, oneCorrect: false, reveals: false, clues: false },
  hot_seat: { key: "hot_seat", label: "Hot seat", hint: "A guest in the seat; viewers pick the question to ask and read the guest's answer.", minOptions: 2, maxOptions: 6, oneCorrect: false, reveals: true, clues: false },
  liar: { key: "liar", label: "Who is lying", hint: "3–4 statements, one is false; spot it.", minOptions: 3, maxOptions: 4, oneCorrect: true, reveals: false, clues: false },
  guess: { key: "guess", label: "Guess the mystery", hint: "Clues first, then 3–4 guesses; one is right.", minOptions: 3, maxOptions: 4, oneCorrect: true, reveals: false, clues: true },
  debate: { key: "debate", label: "Debate", hint: "Two sides with their best argument; pick the side that wins you over.", minOptions: 2, maxOptions: 2, oneCorrect: false, reveals: true, clues: false },
};

export const MECHANIC_KEYS = Object.keys(MECHANICS) as Mechanic[];
export const isMechanic = (m: unknown): m is Mechanic => typeof m === "string" && m in MECHANICS;

/** The fixed answers of an opinion room. */
export const OPINION_SCALE: RoundOption[] = [
  { id: "s1", ar: "أرفض تماماً", en: "Strongly disagree" },
  { id: "s2", ar: "لا أوافق", en: "Disagree" },
  { id: "s3", ar: "محايد", en: "Not sure" },
  { id: "s4", ar: "أوافق", en: "Agree" },
  { id: "s5", ar: "أوافق تماماً", en: "Strongly agree" },
];

export type RoundOption = { id: string; ar: string; en: string; correct?: boolean; revealAr?: string; revealEn?: string };
export type RoundExtra = { cluesAr?: string[]; cluesEn?: string[]; explainAr?: string; explainEn?: string; guestAr?: string; guestEn?: string };
export type Round = { promptAr: string; promptEn: string; options: RoundOption[]; extra: RoundExtra };

export type RoomConfig = {
  /** When results show: right after the viewer answers, or only the next day. */
  results: "after_answer" | "next_day";
  /** Free Ping for a right answer (liar / guess), once per round. 0 = none. */
  rewardPing: number;
  /** What the AI should write when it drafts rounds for this room. */
  aiBrief: string;
  /** Hot seat: who sits in the seat (shown above the questions). */
  guestAr: string;
  guestEn: string;
};

export const DEFAULT_CONFIG: RoomConfig = { results: "after_answer", rewardPing: 0, aiBrief: "", guestAr: "", guestEn: "" };

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const clipList = (v: unknown, n: number, each: number) => (Array.isArray(v) ? v.map((x) => clip(x, each)).filter(Boolean).slice(0, n) : []);

export function sanitizeConfig(raw: unknown): RoomConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const reward = Math.round(Number(r.rewardPing ?? 0));
  return {
    results: r.results === "next_day" ? "next_day" : "after_answer",
    rewardPing: Number.isFinite(reward) ? Math.min(Math.max(reward, 0), 1000) : 0,
    aiBrief: clip(r.aiBrief, 1000),
    guestAr: clip(r.guestAr, 80),
    guestEn: clip(r.guestEn, 80),
  };
}

/** Clean a round from the admin form, the AI or the database. Option ids are rebuilt (a, b, c…). */
export function sanitizeRound(mechanic: Mechanic, raw: unknown): Round {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const spec = MECHANICS[mechanic];
  const ex = (r.extra && typeof r.extra === "object" ? r.extra : {}) as Record<string, unknown>;
  const rawOpts = Array.isArray(r.options) ? r.options : [];
  const options: RoundOption[] =
    mechanic === "opinion"
      ? OPINION_SCALE
      : rawOpts
          .map((o) => (o && typeof o === "object" ? (o as Record<string, unknown>) : {}))
          .map((o) => ({
            ar: clip(o.ar, 160),
            en: clip(o.en, 160),
            correct: spec.oneCorrect ? o.correct === true : undefined,
            revealAr: spec.reveals ? clip(o.revealAr, 600) || undefined : undefined,
            revealEn: spec.reveals ? clip(o.revealEn, 600) || undefined : undefined,
          }))
          .filter((o) => o.ar || o.en)
          .slice(0, spec.maxOptions)
          .map((o, i) => ({ id: String.fromCharCode(97 + i), ...o }));
  const extra: RoundExtra = {};
  if (spec.clues) {
    extra.cluesAr = clipList(ex.cluesAr, 5, 200);
    extra.cluesEn = clipList(ex.cluesEn, 5, 200);
  }
  if (spec.oneCorrect) {
    const a = clip(ex.explainAr, 400);
    const e = clip(ex.explainEn, 400);
    if (a) extra.explainAr = a;
    if (e) extra.explainEn = e;
  }
  return { promptAr: clip(r.promptAr, 400), promptEn: clip(r.promptEn, 400), options, extra };
}

/** Problems that stop a round from being approved. Empty = good to go. */
export function roundIssues(mechanic: Mechanic, round: Round): string[] {
  const spec = MECHANICS[mechanic];
  const issues: string[] = [];
  if (!round.promptAr || !round.promptEn) issues.push("The question needs Arabic and English.");
  if (mechanic !== "opinion") {
    if (round.options.length < spec.minOptions) issues.push(`Needs at least ${spec.minOptions} answers.`);
    if (round.options.some((o) => !o.ar || !o.en)) issues.push("Every answer needs Arabic and English.");
    const seen = new Set(round.options.map((o) => o.en.toLowerCase()));
    if (seen.size < round.options.length) issues.push("Two answers are the same.");
  }
  if (spec.oneCorrect && round.options.filter((o) => o.correct).length !== 1) issues.push("Mark exactly one answer as the right one.");
  if (mechanic === "hot_seat" && round.options.some((o) => !o.revealAr || !o.revealEn)) issues.push("Every question needs the guest's answer in Arabic and English.");
  if (mechanic === "debate" && round.options.some((o) => !o.revealAr || !o.revealEn)) issues.push("Both sides need their argument in Arabic and English.");
  if (spec.clues && (!round.extra.cluesAr?.length || round.extra.cluesAr.length !== round.extra.cluesEn?.length)) issues.push("Add the clues (same number in Arabic and English).");
  return issues;
}

export type Tally = { id: string; count: number; pct: number };

/** Vote counts and whole-number percentages that add up to 100 (largest remainder). */
export function tally(options: RoundOption[], counts: Record<string, number>): { total: number; rows: Tally[] } {
  const total = options.reduce((s, o) => s + (counts[o.id] ?? 0), 0);
  if (total === 0) return { total, rows: options.map((o) => ({ id: o.id, count: 0, pct: 0 })) };
  const raw = options.map((o) => ({ id: o.id, count: counts[o.id] ?? 0, exact: ((counts[o.id] ?? 0) * 100) / total }));
  const rows = raw.map((r) => ({ id: r.id, count: r.count, pct: Math.floor(r.exact) }));
  let left = 100 - rows.reduce((s, r) => s + r.pct, 0);
  const order = raw.map((r, i) => ({ i, rem: r.exact - Math.floor(r.exact) })).sort((a, b) => b.rem - a.rem);
  for (const { i } of order) {
    if (left <= 0) break;
    rows[i].pct += 1;
    left -= 1;
  }
  return { total, rows };
}

/** Right / wrong for mechanics with one right answer, else null. */
export function answerCorrect(mechanic: Mechanic, round: Round, optionId: string): boolean | null {
  if (!MECHANICS[mechanic].oneCorrect) return null;
  return round.options.find((o) => o.id === optionId)?.correct === true;
}

export const validOption = (round: Round, optionId: string) => round.options.some((o) => o.id === optionId);

/** The round that runs on `day`: the approved round with the latest day on or before it. */
export function currentRound<T extends { day: string; status: string }>(rounds: T[], day: string): T | null {
  return rounds.filter((r) => r.status === "approved" && r.day <= day).sort((a, b) => (a.day < b.day ? 1 : -1))[0] ?? null;
}

/** How many days of approved rounds are left after today (0 = runs out today; the admin list warns). */
export function daysPlanned(rounds: { day: string; status: string }[], day: string): number {
  return rounds.filter((r) => r.status === "approved" && r.day > day).length;
}

/** What the viewer sees after answering, as one short line for the share card. */
export function shareLine(round: Round, optionId: string, rows: Tally[], lang: "ar" | "en"): string {
  const o = round.options.find((x) => x.id === optionId);
  const pct = rows.find((r) => r.id === optionId)?.pct ?? 0;
  const pick = o ? (lang === "ar" ? o.ar : o.en) : "";
  return lang === "ar" ? `اخترت «${pick}» — ومعي ${pct}% من الناس. وانت؟` : `I picked “${pick}” — like ${pct}% of people. You?`;
}

// ---------------------------------------------------------------------------
// AI drafting: one tool per mechanic; the AI writes rounds, the team approves them.
// ---------------------------------------------------------------------------

export function roundsTool(mechanic: Mechanic) {
  const spec = MECHANICS[mechanic];
  const option: Record<string, unknown> = { ar: { type: "string" }, en: { type: "string" } };
  const required = ["ar", "en"];
  if (spec.oneCorrect) {
    option.correct = { type: "boolean" };
    required.push("correct");
  }
  if (spec.reveals) {
    option.revealAr = { type: "string" };
    option.revealEn = { type: "string" };
    required.push("revealAr", "revealEn");
  }
  const round: Record<string, unknown> = { promptAr: { type: "string" }, promptEn: { type: "string" } };
  const roundReq = ["promptAr", "promptEn"];
  if (mechanic !== "opinion") {
    round.options = { type: "array", items: { type: "object", properties: option, required, additionalProperties: false } };
    roundReq.push("options");
  }
  if (spec.clues) {
    round.cluesAr = { type: "array", items: { type: "string" } };
    round.cluesEn = { type: "array", items: { type: "string" } };
    roundReq.push("cluesAr", "cluesEn");
  }
  if (spec.oneCorrect) {
    round.explainAr = { type: "string" };
    round.explainEn = { type: "string" };
    roundReq.push("explainAr", "explainEn");
  }
  return {
    name: "save_rounds",
    description: "Save the daily rounds for this room.",
    input_schema: {
      type: "object",
      properties: { rounds: { type: "array", items: { type: "object", properties: round, required: roundReq, additionalProperties: false } } },
      required: ["rounds"],
      additionalProperties: false,
    },
  };
}

export function roundsPrompt(room: { titleEn: string; blurbEn: string; mechanic: Mechanic; config: RoomConfig }, count: number, avoid: string[]): string {
  const spec = MECHANICS[room.mechanic];
  return [
    `You write daily rounds for "${room.titleEn}", a room on Watchat — a fun Arabic-first entertainment app for adults in the Gulf and the wider Arab world.`,
    `Room: ${room.blurbEn}`,
    `Format: ${spec.label} — ${spec.hint}`,
    room.mechanic === "hot_seat" && room.config.guestEn ? `The guest in the seat: ${room.config.guestEn}. Each option is a question to the guest; reveal = the guest's answer in their voice (2–3 sentences).` : "",
    room.mechanic === "debate" ? "Two options = the two sides; reveal = that side's best argument (2 sentences)." : "",
    room.mechanic === "liar" ? "Options are statements; exactly one is false (correct: true marks the lie). explain = why it's false." : "",
    room.mechanic === "guess" ? "3 clues from vague to clear, then 3–4 guesses; exactly one correct. explain = a fun fact." : "",
    room.config.aiBrief ? `Team brief: ${room.config.aiBrief}` : "",
    `Write ${count} rounds. Arabic first: natural, warm, light Gulf / modern Arabic, not a translation; English equally good.`,
    "Keep every question short (under 15 words) and every answer under 8 words. Playful, surprising, shareable.",
    "Never: politics, religion, sex, real private people, insults about groups, gambling, medical or money advice.",
    avoid.length ? `Don't repeat these earlier questions:\n- ${avoid.slice(0, 40).join("\n- ")}` : "",
    "Answer only by calling save_rounds.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function parseRounds(mechanic: Mechanic, raw: unknown): Round[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { rounds?: unknown }).rounds) ? (raw as { rounds: unknown[] }).rounds : [];
  return list
    .map((r) => {
      const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
      return sanitizeRound(mechanic, { ...o, extra: { cluesAr: o.cluesAr, cluesEn: o.cluesEn, explainAr: o.explainAr, explainEn: o.explainEn } });
    })
    .filter((r) => roundIssues(mechanic, r).length === 0);
}
