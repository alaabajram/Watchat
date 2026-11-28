// Daily habit products (pure): the Playground day (Gulf time), the card of the day, the daily question,
// streaks and the 12 star signs. Horoscopes and readings are entertainment and personal reflection.

import { DECK } from "./tarot";

export const PLAY_TZ = "Asia/Dubai";
export const DISCLAIMER = {
  ar: "للترفيه والتأمل الشخصي فقط — مو توقعات حقيقية.",
  en: "For entertainment and personal reflection — not a prediction.",
} as const;

/** The Playground day as YYYY-MM-DD in Gulf time; everything daily flips at midnight there. */
export function playDay(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: PLAY_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Small stable hash (FNV-1a) so a viewer's card for a day never changes on refresh. */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function cardOfDay(viewerId: string, day: string): { card: number; reversed: boolean } {
  const h = hash(`card:${viewerId}:${day}`);
  return { card: h % DECK.length, reversed: (h >>> 8) % 5 === 0 }; // reversed about 1 in 5
}

/** Three different cards for a paid reading (n = how many readings the viewer had before, so each one differs). */
export function readingCards(viewerId: string, day: string, n: number): { card: number; reversed: boolean }[] {
  const picked: { card: number; reversed: boolean }[] = [];
  let salt = 0;
  while (picked.length < 3) {
    const h = hash(`reading:${viewerId}:${day}:${n}:${salt++}`);
    const card = h % DECK.length;
    if (!picked.some((p) => p.card === card)) picked.push({ card, reversed: (h >>> 8) % 5 === 0 });
  }
  return picked;
}

/** Days in a row up to today (yesterday still counts, so the streak isn't lost before the viewer opens the app). */
export function streak(days: string[], today: string): number {
  const set = new Set(days);
  let d = set.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (set.has(d)) {
    n += 1;
    d = addDays(d, -1);
  }
  return n;
}

// ---------------------------------------------------------------------------
// The daily question: one tap, everyone sees the split. Rotates by day.
// ---------------------------------------------------------------------------

export type DailyQuestion = { ar: string; en: string; options: { ar: string; en: string }[] };

export const DAILY_QUESTIONS: DailyQuestion[] = [
  { ar: "وش تحتاج أكثر اليوم؟", en: "What do you need most today?", options: [{ ar: "هدوء", en: "Calm" }, { ar: "مغامرة", en: "Adventure" }, { ar: "ضحكة", en: "A laugh" }, { ar: "إنجاز", en: "A win" }] },
  { ar: "مين تبي تكلمه اليوم؟", en: "Who would you like to hear from today?", options: [{ ar: "صديق قديم", en: "An old friend" }, { ar: "أهلي", en: "Family" }, { ar: "شخص جديد", en: "Someone new" }, { ar: "ولا أحد 😌", en: "Nobody 😌" }] },
  { ar: "وش لون مزاجك؟", en: "What colour is your mood?", options: [{ ar: "أزرق هادي", en: "Calm blue" }, { ar: "أصفر مشمس", en: "Sunny yellow" }, { ar: "أحمر نشيط", en: "Fiery red" }, { ar: "رمادي غايم", en: "Cloudy grey" }] },
  { ar: "لو عندك ساعة فاضية الحين؟", en: "A free hour right now — you'd…", options: [{ ar: "أنام", en: "Nap" }, { ar: "أطلع أتمشى", en: "Go for a walk" }, { ar: "أشوف مسلسل", en: "Watch a show" }, { ar: "أتعلم شي", en: "Learn something" }] },
  { ar: "وش الشي اللي تبي تتركه اليوم؟", en: "What would you like to let go of today?", options: [{ ar: "القلق", en: "Worry" }, { ar: "التأجيل", en: "Putting things off" }, { ar: "التفكير الزايد", en: "Overthinking" }, { ar: "التلفون 😅", en: "My phone 😅" }] },
  { ar: "وش يفرحك بسرعة؟", en: "What cheers you up fastest?", options: [{ ar: "أكل حلو", en: "Good food" }, { ar: "موسيقى", en: "Music" }, { ar: "سوالف", en: "A chat" }, { ar: "طلعة", en: "Going out" }] },
  { ar: "نفسك اليوم تكون…", en: "Today you'd like to be…", options: [{ ar: "أشجع", en: "Braver" }, { ar: "أهدى", en: "Calmer" }, { ar: "ألطف", en: "Kinder" }, { ar: "أنشط", en: "More energetic" }] },
];

export function questionOfDay(day: string): { index: number; q: DailyQuestion } {
  const index = hash(`q:${day}`) % DAILY_QUESTIONS.length;
  return { index, q: DAILY_QUESTIONS[index] };
}

// ---------------------------------------------------------------------------
// Star signs.
// ---------------------------------------------------------------------------

export type Sign = "aries" | "taurus" | "gemini" | "cancer" | "leo" | "virgo" | "libra" | "scorpio" | "sagittarius" | "capricorn" | "aquarius" | "pisces";

export const SIGNS: { key: Sign; ar: string; en: string; symbol: string; from: [number, number]; to: [number, number] }[] = [
  { key: "aries", ar: "الحمل", en: "Aries", symbol: "♈", from: [3, 21], to: [4, 19] },
  { key: "taurus", ar: "الثور", en: "Taurus", symbol: "♉", from: [4, 20], to: [5, 20] },
  { key: "gemini", ar: "الجوزاء", en: "Gemini", symbol: "♊", from: [5, 21], to: [6, 20] },
  { key: "cancer", ar: "السرطان", en: "Cancer", symbol: "♋", from: [6, 21], to: [7, 22] },
  { key: "leo", ar: "الأسد", en: "Leo", symbol: "♌", from: [7, 23], to: [8, 22] },
  { key: "virgo", ar: "العذراء", en: "Virgo", symbol: "♍", from: [8, 23], to: [9, 22] },
  { key: "libra", ar: "الميزان", en: "Libra", symbol: "♎", from: [9, 23], to: [10, 22] },
  { key: "scorpio", ar: "العقرب", en: "Scorpio", symbol: "♏", from: [10, 23], to: [11, 21] },
  { key: "sagittarius", ar: "القوس", en: "Sagittarius", symbol: "♐", from: [11, 22], to: [12, 21] },
  { key: "capricorn", ar: "الجدي", en: "Capricorn", symbol: "♑", from: [12, 22], to: [1, 19] },
  { key: "aquarius", ar: "الدلو", en: "Aquarius", symbol: "♒", from: [1, 20], to: [2, 18] },
  { key: "pisces", ar: "الحوت", en: "Pisces", symbol: "♓", from: [2, 19], to: [3, 20] },
];

export const isSign = (s: unknown): s is Sign => typeof s === "string" && SIGNS.some((x) => x.key === s);
export const signInfo = (s: Sign) => SIGNS.find((x) => x.key === s)!;

/** The sign for a birthday (month 1–12, day 1–31). */
export function signFor(month: number, day: number): Sign {
  const md = month * 100 + day;
  for (const s of SIGNS) {
    const from = s.from[0] * 100 + s.from[1];
    const to = s.to[0] * 100 + s.to[1];
    if (from <= to ? md >= from && md <= to : md >= from || md <= to) return s.key;
  }
  return "capricorn";
}

export const signDates = (s: Sign, lang: "ar" | "en") => {
  const i = signInfo(s);
  const m = (n: number) => new Intl.DateTimeFormat(lang === "ar" ? "ar" : "en", { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2026, n - 1, 1)));
  return `${i.from[1]} ${m(i.from[0])} – ${i.to[1]} ${m(i.to[0])}`;
};

// ---------------------------------------------------------------------------
// Horoscope drafting (AI) and the fallback lines when no approved reading exists for the day.
// ---------------------------------------------------------------------------

export type HoroscopeDraft = { sign: Sign; ar: string; en: string; luckyNumber: number; moodAr: string; moodEn: string };

export const HOROSCOPE_TOOL = {
  name: "save_horoscopes",
  description: "Save one daily reading per star sign.",
  input_schema: {
    type: "object",
    properties: {
      signs: {
        type: "array",
        items: {
          type: "object",
          properties: {
            sign: { type: "string", enum: SIGNS.map((s) => s.key) },
            ar: { type: "string" },
            en: { type: "string" },
            luckyNumber: { type: "integer" },
            moodAr: { type: "string" },
            moodEn: { type: "string" },
          },
          required: ["sign", "ar", "en", "luckyNumber", "moodAr", "moodEn"],
          additionalProperties: false,
        },
      },
    },
    required: ["signs"],
    additionalProperties: false,
  },
};

export function horoscopePrompt(day: string, brief = ""): string {
  return [
    `Write the Watchat daily horoscope for ${day} — one reading for each of the 12 signs.`,
    "Watchat horoscopes are ENTERTAINMENT AND PERSONAL REFLECTION, never predictions. Don't claim events will happen. Use gentle, reflective wording: an invitation, a small idea to try, a question to think about.",
    "Each reading: 35–55 words, warm and specific, a little playful; Arabic first in natural light Gulf / modern Arabic (not a translation), English equally good. Each sign different.",
    "Never: health, medical, money or investment advice, relationship ultimatums, religion, politics, fear. moodAr/moodEn: one or two words. luckyNumber: 1–99.",
    brief ? `Team brief: ${brief}` : "",
    "Answer only by calling save_horoscopes with all 12 signs.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function parseHoroscopes(raw: unknown): HoroscopeDraft[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { signs?: unknown }).signs) ? (raw as { signs: unknown[] }).signs : [];
  const seen = new Set<string>();
  const out: HoroscopeDraft[] = [];
  for (const r of list) {
    const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    if (!isSign(o.sign) || seen.has(o.sign)) continue;
    const ar = typeof o.ar === "string" ? o.ar.trim().slice(0, 800) : "";
    const en = typeof o.en === "string" ? o.en.trim().slice(0, 800) : "";
    if (!ar || !en) continue;
    seen.add(o.sign);
    const n = Math.round(Number(o.luckyNumber));
    out.push({
      sign: o.sign,
      ar,
      en,
      luckyNumber: Number.isFinite(n) && n >= 1 && n <= 99 ? n : 7,
      moodAr: typeof o.moodAr === "string" ? o.moodAr.trim().slice(0, 30) : "",
      moodEn: typeof o.moodEn === "string" ? o.moodEn.trim().slice(0, 30) : "",
    });
  }
  return out;
}

const FALLBACK: { ar: string; en: string }[] = [
  { ar: "اليوم مناسب لخطوة صغيرة كنت تأجلها. مو لازم تكون مثالية، بس ابدأ.", en: "A good day for a small step you've been putting off. It doesn't need to be perfect — just start." },
  { ar: "لاحظ مين يخليك تضحك اليوم، وقل له شكراً.", en: "Notice who makes you laugh today, and tell them thanks." },
  { ar: "خذ دقيقة هدوء قبل أي قرار. الجواب أوضح مما تتوقع.", en: "Take a quiet minute before any decision. The answer is clearer than you think." },
  { ar: "جرّب شي جديد ولو بسيط: طريق ثاني، أكلة ثانية، أغنية ثانية.", en: "Try something new, however small: another route, another dish, another song." },
  { ar: "رتّب زاوية وحدة حولك، وبتحس إن راسك ترتب معها.", en: "Tidy one corner around you, and feel your head tidy with it." },
  { ar: "رسالة قصيرة لشخص تفتقده ممكن تصنع يومه — ويومك.", en: "A short message to someone you miss could make their day — and yours." },
  { ar: "مو كل سؤال يحتاج جواب اليوم. خلّ بعض الأشياء تنضج.", en: "Not every question needs an answer today. Let some things ripen." },
  { ar: "اكتب ثلاث أشياء حلوة صارت هالأسبوع. بتتفاجأ.", en: "Write down three good things from this week. You'll be surprised." },
];

export function fallbackHoroscope(sign: Sign, day: string): { ar: string; en: string; luckyNumber: number } {
  const h = hash(`h:${sign}:${day}`);
  const f = FALLBACK[h % FALLBACK.length];
  return { ...f, luckyNumber: (h % 99) + 1 };
}

// ---------------------------------------------------------------------------
// Phase 2: streak rewards, the weekly score window and the morning reminder.
// ---------------------------------------------------------------------------

export type StreakRewards = Record<number, number>;
export const DEFAULT_STREAK_REWARDS: StreakRewards = { 3: 5, 7: 15, 14: 25, 30: 60 };

/** Clean the admin's "3:5, 7:15" text or the stored JSON into day → Ping (days 2–365, Ping 1–1000, at most 10). */
export function parseStreakRewards(raw: unknown): StreakRewards {
  const pairs: [number, number][] =
    typeof raw === "string"
      ? raw.split(/[,\n]/).map((p) => p.split(/[:=]/).map((x) => Number(x.trim())) as [number, number])
      : raw && typeof raw === "object"
        ? Object.entries(raw as Record<string, unknown>).map(([k, v]) => [Number(k), Number(v)])
        : [];
  const out: StreakRewards = {};
  for (const [d, p] of pairs) {
    if (Number.isInteger(d) && d >= 2 && d <= 365 && Number.isFinite(p) && p >= 1) out[d] = Math.min(Math.round(p), 1000);
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => Number(a[0]) - Number(b[0])).slice(0, 10));
}

export const streakRewardsText = (r: StreakRewards) => Object.entries(r).map(([d, p]) => `${d}:${p}`).join(", ");

/** The reward for reaching exactly `days` in a row (0 when that day isn't a milestone). */
export const streakReward = (days: number, r: StreakRewards) => r[days] ?? 0;

/** The next milestone after `days`, or null. */
export function nextMilestone(days: number, r: StreakRewards): { day: number; ping: number; left: number } | null {
  const d = Object.keys(r).map(Number).sort((a, b) => a - b).find((x) => x > days);
  return d ? { day: d, ping: r[d], left: d - days } : null;
}

/** The streak's first day, so each run of days earns each milestone once. */
export const streakStart = (today: string, days: number) => addDays(today, -(days - 1));

/** Monday of the Playground week (weekly scores reset then). */
export function weekStart(day: string): string {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}

/** The Gulf-time hour (0–23). */
export function playHour(at: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: PLAY_TZ, hour: "2-digit", hour12: false }).format(at)) % 24;
}

/** The morning reminder: the sign's reading if the viewer picked one, else the card of the day. */
export function morningPush(sign: Sign | null, lang: "ar" | "en"): { title: string; body: string; url: string } {
  const s = sign ? signInfo(sign) : null;
  if (lang === "ar") {
    return s
      ? { title: `${s.symbol} برج ${s.ar} لليوم جاهز`, body: "وبطاقة اليوم تنتظرك 🔮 لا تضيّع سلسلتك!", url: "/today" }
      : { title: "🔮 بطاقة اليوم تنتظرك", body: "اسحبها، جاوب سؤال اليوم، وكمّل سلسلتك.", url: "/today" };
  }
  return s
    ? { title: `${s.symbol} Your ${s.en} reading for today is ready`, body: "Your card of the day is waiting too 🔮 Keep your streak going!", url: "/today" }
    : { title: "🔮 Your card of the day is waiting", body: "Draw it, answer today's question and keep your streak going.", url: "/today" };
}
