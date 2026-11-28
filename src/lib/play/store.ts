// Playground data (server-only): rooms and their daily rounds, AI People chats, the Fortune Teller, the daily
// horoscope and streaks. Money only moves through grant_reward / spend_ping; AI only through the label's key.

import { AiError, callTool } from "../ai/anthropic";
import { aiAccount, logAiUsage, playAccount } from "../ai/settings";
import { cardOfDay, fallbackHoroscope, horoscopePrompt, HOROSCOPE_TOOL, isSign, morningPush, nextMilestone, parseHoroscopes, parseStreakRewards, playDay, playHour, questionOfDay, readingCards, streak, streakReward, streakStart, weekStart, addDays, type Sign, type StreakRewards } from "../daily/daily";
import { sendPush } from "../push/push";
import { cardById, readingPrompt, READING_TOOL, readingWithoutAi } from "../daily/tarot";
import { grantPing } from "../economy/rewards";
import { trackEvent } from "../events";
import { cardRow, STARTER_CARDS, toCard, type HeroCard } from "../people/card";
import { nextMessageQuota, parseReply, personaSystemPrompt, recentTurns, REPLY_TOOL, STARTER_PEOPLE, type Person } from "../people/persona";
import { answerCorrect, currentRound, isMechanic, parseRounds, roundsPrompt, roundsTool, sanitizeConfig, sanitizeRound, tally, validOption, type Mechanic, type RoomConfig, type Round, type Tally } from "../rooms/engine";
import { STARTER_ROOMS } from "../rooms/starter";
import { publicUrlFor } from "../storage/cloudflare";
import { weeklyWinners } from "../rooms/display";
import { cleanPath, isHomeSlot, sanitizeHome, type HomeContent, type HomeSlot } from "./home";
import { allow } from "../security/rate-limit";
import type { SessionViewer } from "../session";
import { currentTenantId, db } from "../supabase";
import { getBalance } from "../wallet";

export type Settings = { readingPing: number; peopleDailyAiCap: number; horoscopeAutoApprove: boolean; streakRewards: StreakRewards; morningPush: boolean; morningHour: number; weeklyPrizePing: number };

export async function playSettings(tenantId: string): Promise<Settings> {
  const { data } = await db().from("playground_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
  return {
    readingPing: data?.reading_ping ?? 20,
    peopleDailyAiCap: data?.people_daily_ai_cap ?? 2000,
    horoscopeAutoApprove: data?.horoscope_auto_approve ?? false,
    streakRewards: data?.streak_rewards ? parseStreakRewards(data.streak_rewards) : parseStreakRewards({ 3: 5, 7: 15, 14: 25, 30: 60 }),
    morningPush: data?.morning_push ?? true,
    morningHour: data?.morning_hour ?? 8,
    weeklyPrizePing: data?.weekly_prize_ping ?? 0,
  };
}

async function spendPing(viewerId: string, amount: number, refType: string, refId: string, key: string): Promise<"ok" | "already" | "insufficient"> {
  const { data, error } = await db().rpc("spend_ping", { p_viewer: viewerId, p_amount: amount, p_ref_type: refType, p_ref_id: refId, p_key: key });
  if (error) throw new Error(`spend_ping failed: ${error.message}`);
  return data as "ok" | "already" | "insufficient";
}

async function habitDays(viewerId: string, day: string): Promise<string[]> {
  const { data } = await db().from("habit_days").select("day").eq("viewer_id", viewerId).gte("day", addDays(day, -400));
  return (data ?? []).map((h) => h.day as string);
}

/** Mark the viewer active today; on the first visit of a day that reaches a streak milestone, grant its Ping (once per run). */
export async function touchHabit(viewerId: string, day = playDay()): Promise<number> {
  const { data } = await db().from("habit_days").upsert({ viewer_id: viewerId, day }, { onConflict: "viewer_id,day", ignoreDuplicates: true }).select("day");
  if (!data?.length) return 0; // already counted today
  try {
    const settings = await playSettings(await currentTenantId());
    const days = streak(await habitDays(viewerId, day), day);
    const ping = streakReward(days, settings.streakRewards);
    if (ping > 0 && (await grantPing(viewerId, ping, "streak", `streak:${viewerId}:${streakStart(day, days)}:${days}`))) return ping;
  } catch (e) {
    console.error("[play] streak reward failed", e);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Starter content: the six rooms and seven AI People, added once.
// ---------------------------------------------------------------------------

export async function addStarterRooms(tenantId: string, onlyIfEmpty = true): Promise<number> {
  if (onlyIfEmpty) {
    const { count } = await db().from("rooms").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
    if ((count ?? 0) > 0) return 0;
  }
  const { data: have } = await db().from("rooms").select("slug").eq("tenant_id", tenantId);
  const taken = new Set((have ?? []).map((r) => r.slug as string));
  const today = playDay();
  let added = 0;
  for (const [i, r] of STARTER_ROOMS.entries()) {
    if (taken.has(r.slug)) continue;
    const { data: room, error } = await db()
      .from("rooms")
      .insert({ tenant_id: tenantId, slug: r.slug, mechanic: r.mechanic, title_ar: r.titleAr, title_en: r.titleEn, blurb_ar: r.blurbAr, blurb_en: r.blurbEn, emoji: r.emoji, color: r.color, status: "live", config: sanitizeConfig(r.config), sort: i, tag_ar: r.tagAr ?? "", tag_en: r.tagEn ?? "", home_slot: r.homeSlot ?? "tile", group_ar: r.groupAr ?? "", group_en: r.groupEn ?? "" })
      .select("id")
      .single();
    if (error || !room) continue;
    const rounds = r.rounds.map((x, n) => {
      const clean = sanitizeRound(r.mechanic, x);
      return { tenant_id: tenantId, room_id: room.id, day: addDays(today, n), prompt_ar: clean.promptAr, prompt_en: clean.promptEn, options: clean.options, extra: clean.extra, status: "approved", source: "team" };
    });
    await db().from("room_rounds").insert(rounds);
    added += 1;
  }
  return added;
}

export async function addStarterPeople(tenantId: string, onlyIfEmpty = true): Promise<number> {
  if (onlyIfEmpty) {
    const { count } = await db().from("ai_people").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
    if ((count ?? 0) > 0) return 0;
  }
  const { data: have } = await db().from("ai_people").select("slug").eq("tenant_id", tenantId);
  const taken = new Set((have ?? []).map((r) => r.slug as string));
  const rows = STARTER_PEOPLE.filter((p) => !taken.has(p.slug)).map((p, i) => ({ tenant_id: tenantId, ...personRow(p), slug: p.slug, status: "live", sort: i, tag_ar: STARTER_TAGS[p.slug]?.[0] ?? "", tag_en: STARTER_TAGS[p.slug]?.[1] ?? "", ...(STARTER_CARDS[p.slug] ? cardRow(STARTER_CARDS[p.slug]) : {}) }));
  if (!rows.length) return 0;
  const { error } = await db().from("ai_people").insert(rows);
  return error ? 0 : rows.length;
}

/** Home page labels for the starter AI People. */
const STARTER_TAGS: Record<string, [string, string]> = {
  layla: ["الأخت الكبيرة", "Big sister"],
  "abu-saleh": ["الحكواتي", "Storyteller"],
  "chef-salma": ["الشيف", "Home chef"],
  "coach-fahd": ["مشجع", "Super fan"],
  nour: ["شاعرة", "Poet"],
  zain: ["قيمر", "Gamer"],
  "madame-zahra": ["عرّافة", "Fortune teller"],
};

export function personRow(p: Omit<Person, "slug">) {
  return {
    name_ar: p.nameAr,
    name_en: p.nameEn,
    role_ar: p.roleAr,
    role_en: p.roleEn,
    emoji: p.emoji,
    color: p.color,
    persona: p.persona,
    greeting_ar: p.greetingAr,
    greeting_en: p.greetingEn,
    starters: p.starters,
    free_per_day: p.freePerDay,
    ping_per_message: p.pingPerMessage,
    updated_at: new Date().toISOString(),
  };
}

/** The first time the Playground opens on a label with nothing set up, it fills in the starter content. */
export async function ensureStarter(tenantId: string): Promise<void> {
  try {
    await Promise.all([addStarterRooms(tenantId), addStarterPeople(tenantId)]);
  } catch (e) {
    console.error("[play] starter content failed", e);
  }
}

// ---------------------------------------------------------------------------
// Rooms.
// ---------------------------------------------------------------------------

export type RoomRow = {
  id: string;
  slug: string;
  mechanic: Mechanic;
  titleAr: string;
  titleEn: string;
  blurbAr: string;
  blurbEn: string;
  emoji: string;
  color: string;
  status: string;
  config: RoomConfig;
  sort: number;
  imagePath: string | null;
  image: string | null;
  tagAr: string;
  tagEn: string;
  homeSlot: HomeSlot;
  groupAr: string;
  groupEn: string;
  ctaAr: string;
  ctaEn: string;
};

/** A link for a stored Playground picture (only paths we made). */
export function playImage(path: unknown): string | null {
  const p = cleanPath(path);
  return p ? publicUrlFor(p) : null;
}
export type RoundRow = Round & { id: string; day: string; status: string; source: string };

export function toRoom(r: Record<string, unknown>): RoomRow {
  const mechanic = isMechanic(r.mechanic) ? r.mechanic : "poll";
  return {
    id: r.id as string,
    slug: r.slug as string,
    mechanic,
    titleAr: r.title_ar as string,
    titleEn: r.title_en as string,
    blurbAr: (r.blurb_ar as string) ?? "",
    blurbEn: (r.blurb_en as string) ?? "",
    emoji: (r.emoji as string) ?? "💬",
    color: (r.color as string) ?? "#ff5a48",
    status: r.status as string,
    config: sanitizeConfig(r.config),
    sort: (r.sort as number) ?? 0,
    imagePath: cleanPath(r.image_path),
    image: playImage(r.image_path),
    tagAr: (r.tag_ar as string) ?? "",
    tagEn: (r.tag_en as string) ?? "",
    homeSlot: isHomeSlot(r.home_slot) ? r.home_slot : "tile",
    groupAr: (r.group_ar as string) ?? "",
    groupEn: (r.group_en as string) ?? "",
    ctaAr: (r.cta_ar as string) ?? "",
    ctaEn: (r.cta_en as string) ?? "",
  };
}

export function toRound(mechanic: Mechanic, r: Record<string, unknown>): RoundRow {
  const clean = sanitizeRound(mechanic, { promptAr: r.prompt_ar, promptEn: r.prompt_en, options: r.options, extra: r.extra });
  // Keep the stored ids (answers point at them).
  const stored = Array.isArray(r.options) ? (r.options as { id?: string }[]) : [];
  if (mechanic !== "opinion") clean.options = clean.options.map((o, i) => ({ ...o, id: stored[i]?.id || o.id }));
  return { ...clean, id: r.id as string, day: r.day as string, status: r.status as string, source: r.source as string };
}

export type RoomCard = RoomRow & { round: RoundRow | null; answered: boolean; players: number; /** How many rounds this room has run so far (today's included). */ roundNo: number };

/** Live rooms with today's round and whether this viewer has played it. */
export async function liveRooms(tenantId: string, viewerId: string | null, day = playDay()): Promise<RoomCard[]> {
  const { data: rooms } = await db().from("rooms").select("*").eq("tenant_id", tenantId).eq("status", "live").order("sort");
  const list = (rooms ?? []).map(toRoom);
  if (!list.length) return [];
  const { data: rounds } = await db()
    .from("room_rounds")
    .select("id, room_id, day, status, source, prompt_ar, prompt_en, options, extra")
    .in("room_id", list.map((r) => r.id))
    .eq("status", "approved")
    .lte("day", day)
    .gte("day", addDays(day, -60));
  const byRoom = new Map<string, RoundRow>();
  const roundNo = new Map<string, number>();
  for (const room of list) {
    const mine = (rounds ?? []).filter((r) => r.room_id === room.id) as Record<string, unknown>[];
    roundNo.set(room.id, mine.length);
    const cur = currentRound(mine as { day: string; status: string }[], day) as Record<string, unknown> | null;
    if (cur) byRoom.set(room.id, toRound(room.mechanic, cur));
  }
  const ids = [...byRoom.values()].map((r) => r.id);
  const [{ data: mine }, counts] = await Promise.all([
    viewerId && ids.length ? db().from("room_answers").select("round_id").eq("viewer_id", viewerId).in("round_id", ids) : Promise.resolve({ data: [] as { round_id: string }[] }),
    Promise.all(ids.map(async (id) => [id, (await db().from("room_answers").select("round_id", { count: "exact", head: true }).eq("round_id", id)).count ?? 0] as const)),
  ]);
  const played = new Set((mine ?? []).map((m) => m.round_id as string));
  const players = new Map(counts);
  return list.map((room) => {
    const round = byRoom.get(room.id) ?? null;
    return { ...room, round, answered: round ? played.has(round.id) : false, players: round ? (players.get(round.id) ?? 0) : 0, roundNo: roundNo.get(room.id) ?? 0 };
  });
}

async function countsFor(roundId: string): Promise<Record<string, number>> {
  const { data } = await db().from("room_answers").select("option_id").eq("round_id", roundId).limit(50000);
  const counts: Record<string, number> = {};
  for (const a of data ?? []) counts[a.option_id as string] = (counts[a.option_id as string] ?? 0) + 1;
  return counts;
}

export type RoomView = { room: RoomRow; round: RoundRow | null; myAnswer: string | null; correct: boolean | null; results: { total: number; rows: Tally[] } | null; showResults: boolean };

export async function roomView(tenantId: string, slug: string, viewerId: string | null, day = playDay()): Promise<RoomView | null> {
  const { data } = await db().from("rooms").select("*").eq("tenant_id", tenantId).eq("slug", slug).eq("status", "live").maybeSingle();
  if (!data) return null;
  const room = toRoom(data);
  const { data: rounds } = await db().from("room_rounds").select("*").eq("room_id", room.id).eq("status", "approved").lte("day", day).order("day", { ascending: false }).limit(1);
  const round = rounds?.[0] ? toRound(room.mechanic, rounds[0]) : null;
  if (!round) return { room, round: null, myAnswer: null, correct: null, results: null, showResults: false };
  const { data: ans } = viewerId ? await db().from("room_answers").select("option_id, correct").eq("round_id", round.id).eq("viewer_id", viewerId).maybeSingle() : { data: null };
  const myAnswer = (ans?.option_id as string) ?? null;
  const showResults = Boolean(myAnswer) && room.config.results === "after_answer";
  const results = showResults ? tally(round.options, await countsFor(round.id)) : null;
  return { room, round, myAnswer, correct: (ans?.correct as boolean | null) ?? null, results, showResults };
}

export type AnswerResult = { ok: true; view: RoomView; rewarded: number } | { ok: false; error: "not_found" | "bad_option" | "slow_down" };

export async function answerRoom(tenantId: string, viewer: SessionViewer, slug: string, optionId: string): Promise<AnswerResult> {
  if (!(await allow(`room:${viewer.id}`, 60, 600))) return { ok: false, error: "slow_down" };
  const view = await roomView(tenantId, slug, viewer.id);
  if (!view?.round) return { ok: false, error: "not_found" };
  if (!validOption(view.round, optionId)) return { ok: false, error: "bad_option" };
  let rewarded = 0;
  if (!view.myAnswer) {
    const correct = answerCorrect(view.room.mechanic, view.round, optionId);
    const { error } = await db().from("room_answers").insert({ round_id: view.round.id, viewer_id: viewer.id, option_id: optionId, correct });
    if (!error) {
      await touchHabit(viewer.id);
      if (correct && view.room.config.rewardPing > 0 && (await grantPing(viewer.id, view.room.config.rewardPing, "room", `room:${view.round.id}:${viewer.id}`))) rewarded = view.room.config.rewardPing;
      await trackEvent({ viewerHmac: viewer.phoneHmac, name: "room_answer", props: { room: slug, mechanic: view.room.mechanic, correct } });
    }
  }
  const after = await roomView(tenantId, slug, viewer.id);
  return { ok: true, view: after ?? view, rewarded };
}

/** AI drafts of the next rounds for a room (status draft; the team approves each). */
export async function draftRounds(tenantId: string, adminId: string, roomId: string, count: number): Promise<{ added: number; error?: string }> {
  const { data } = await db().from("rooms").select("*").eq("tenant_id", tenantId).eq("id", roomId).maybeSingle();
  if (!data) return { added: 0, error: "Room not found." };
  const room = toRoom(data);
  const account = await aiAccount(tenantId);
  if (!account.ok) return { added: 0, error: account.reason };
  const { data: existing } = await db().from("room_rounds").select("day, prompt_en, options").eq("room_id", roomId).order("day", { ascending: false }).limit(60);
  const avoid = (existing ?? []).map((r) => `${r.prompt_en} ${((r.options as { en?: string }[]) ?? []).map((o) => o.en).join(" / ")}`.trim());
  try {
    const r = await callTool({ apiKey: account.apiKey, model: account.model, system: roundsPrompt(room, count, avoid), turns: [{ role: "user", content: `Write ${count} rounds.` }], tool: roundsTool(room.mechanic), maxTokens: 6000 });
    await logAiUsage({ tenantId, adminId, purpose: "rooms", model: account.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, ok: true });
    const rounds = parseRounds(room.mechanic, r.input).slice(0, count);
    // Schedule after the last planned day (or from tomorrow).
    const last = (existing ?? []).map((x) => x.day as string).sort().pop();
    let day = last && last >= playDay() ? addDays(last, 1) : addDays(playDay(), 1);
    const rows = rounds.map((x) => {
      const row = { tenant_id: tenantId, room_id: roomId, day, prompt_ar: x.promptAr, prompt_en: x.promptEn, options: x.options, extra: x.extra, status: "draft", source: "ai" };
      day = addDays(day, 1);
      return row;
    });
    if (rows.length) {
      const { error } = await db().from("room_rounds").insert(rows);
      if (error) return { added: 0, error: error.message };
    }
    return { added: rows.length };
  } catch (e) {
    await logAiUsage({ tenantId, adminId, purpose: "rooms", model: account.model, ok: false, error: e instanceof AiError ? e.message : "failed" });
    return { added: 0, error: e instanceof Error ? e.message : "The AI couldn't write rounds right now." };
  }
}

// ---------------------------------------------------------------------------
// AI People.
// ---------------------------------------------------------------------------

export type PersonRow = Person & {
  id: string;
  status: string;
  sort: number;
  imagePath: string | null;
  image: string | null;
  tagAr: string;
  tagEn: string;
  card: HeroCard;
  voicePath: string | null;
  voice: string | null;
};

export function toPerson(r: Record<string, unknown>): PersonRow {
  return {
    id: r.id as string,
    slug: r.slug as string,
    nameAr: r.name_ar as string,
    nameEn: r.name_en as string,
    roleAr: (r.role_ar as string) ?? "",
    roleEn: (r.role_en as string) ?? "",
    emoji: (r.emoji as string) ?? "🙂",
    color: (r.color as string) ?? "#7c5cff",
    persona: (r.persona as string) ?? "",
    greetingAr: (r.greeting_ar as string) ?? "",
    greetingEn: (r.greeting_en as string) ?? "",
    starters: ((r.starters as { ar: string; en: string }[]) ?? []).slice(0, 4),
    freePerDay: (r.free_per_day as number) ?? 10,
    pingPerMessage: (r.ping_per_message as number) ?? 1,
    status: r.status as string,
    sort: (r.sort as number) ?? 0,
    imagePath: cleanPath(r.image_path),
    image: playImage(r.image_path),
    tagAr: (r.tag_ar as string) ?? "",
    tagEn: (r.tag_en as string) ?? "",
    card: toCard(r),
    voicePath: cleanPath(r.voice_path),
    voice: playImage(r.voice_path),
  };
}

/** How many messages the viewer has sent each AI person (for the affinity level on the Heroes page). */
export async function affinities(viewerId: string): Promise<Map<string, number>> {
  const { data: chats } = await db().from("ai_chats").select("id, person_id").eq("viewer_id", viewerId);
  const out = new Map<string, number>();
  await Promise.all(
    (chats ?? []).map(async (c) => {
      const { count } = await db().from("ai_chat_messages").select("id", { count: "exact", head: true }).eq("chat_id", c.id).eq("role", "user");
      out.set(c.person_id as string, count ?? 0);
    }),
  );
  return out;
}

export async function livePeople(tenantId: string): Promise<PersonRow[]> {
  const { data } = await db().from("ai_people").select("*").eq("tenant_id", tenantId).eq("status", "live").order("sort");
  return (data ?? []).map(toPerson);
}

export async function personBySlug(tenantId: string, slug: string): Promise<PersonRow | null> {
  const { data } = await db().from("ai_people").select("*").eq("tenant_id", tenantId).eq("slug", slug).eq("status", "live").maybeSingle();
  return data ? toPerson(data) : null;
}

const HISTORY_DAYS = 30;

async function chatFor(tenantId: string, viewerId: string, personId: string, create: boolean): Promise<string | null> {
  const { data } = await db().from("ai_chats").select("id").eq("viewer_id", viewerId).eq("person_id", personId).maybeSingle();
  if (data) return data.id as string;
  if (!create) return null;
  const { data: made } = await db().from("ai_chats").upsert({ tenant_id: tenantId, viewer_id: viewerId, person_id: personId }, { onConflict: "viewer_id,person_id" }).select("id").single();
  return (made?.id as string) ?? null;
}

const dayStartUtc = () => {
  // Messages "today" = since Gulf midnight.
  const day = playDay();
  return new Date(`${day}T00:00:00+04:00`).toISOString();
};

export type ChatMessage = { role: "user" | "assistant"; content: string; at: string };
export type ChatState = { messages: ChatMessage[]; freeLeft: number; cost: number; balance: number };

export async function chatState(tenantId: string, viewerId: string, person: PersonRow): Promise<ChatState> {
  const chatId = await chatFor(tenantId, viewerId, person.id, false);
  const since = new Date(Date.now() - HISTORY_DAYS * 86400_000).toISOString();
  const [{ data: rows }, { count }, balance] = await Promise.all([
    chatId ? db().from("ai_chat_messages").select("role, content, created_at").eq("chat_id", chatId).gte("created_at", since).order("created_at", { ascending: false }).limit(60) : Promise.resolve({ data: [] }),
    chatId ? db().from("ai_chat_messages").select("id", { count: "exact", head: true }).eq("chat_id", chatId).eq("role", "user").gte("created_at", dayStartUtc()) : Promise.resolve({ count: 0 }),
    getBalance(viewerId),
  ]);
  const q = nextMessageQuota(count ?? 0, person);
  const messages = ((rows ?? []) as { role: "user" | "assistant"; content: string; created_at: string }[]).reverse().map((r) => ({ role: r.role, content: r.content, at: r.created_at }));
  return { messages, freeLeft: q.freeLeft, cost: q.cost, balance };
}

const RESTING = {
  ar: "أنا مرتاح شوي الحين 😴 ارجع لي بعد شوي وبنكمل السالفة.",
  en: "I'm taking a little break right now 😴 Come back soon and we'll pick up where we left off.",
};

export type SendResult = { ok: true; reply: string; suggestions: string[]; state: ChatState } | { ok: false; error: "slow_down" | "need_ping" | "empty"; cost?: number };

export async function sendToPerson(tenantId: string, viewer: SessionViewer, person: PersonRow, text: string): Promise<SendResult> {
  const message = text.trim().slice(0, 600);
  if (!message) return { ok: false, error: "empty" };
  if (!(await allow(`people:${viewer.id}`, 30, 600))) return { ok: false, error: "slow_down" };
  const before = await chatState(tenantId, viewer.id, person);
  if (before.cost > 0 && before.balance < before.cost) return { ok: false, error: "need_ping", cost: before.cost };
  const chatId = await chatFor(tenantId, viewer.id, person.id, true);
  if (!chatId) throw new Error("chat could not be created");

  const settings = await playSettings(tenantId);
  const account = await playAccount(tenantId, settings.peopleDailyAiCap);
  let reply = RESTING[viewer.uiLocale];
  let suggestions: string[] = [];
  let answered = false;
  if (account.ok) {
    const turns = recentTurns([...before.messages, { role: "user" as const, content: message, at: "" }]).map((t) =>
      t.role === "user" ? { role: "user" as const, content: `<<<${t.content}>>>` } : t,
    );
    try {
      const r = await callTool({ apiKey: account.apiKey, model: account.model, system: personaSystemPrompt(person, viewer.uiLocale), turns, tool: REPLY_TOOL, maxTokens: 500 });
      await logAiUsage({ tenantId, adminId: null, purpose: "ai_people", model: account.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, ok: true });
      const out = parseReply(r.input);
      if (out.text) {
        reply = out.text;
        suggestions = out.suggestions;
        answered = true;
      }
    } catch (e) {
      await logAiUsage({ tenantId, adminId: null, purpose: "ai_people", model: account.model, ok: false, error: e instanceof AiError ? e.message : "failed" });
    }
  }
  // Charge only for a real answer.
  let paid = false;
  if (answered && before.cost > 0) paid = (await spendPing(viewer.id, before.cost, "ai_people", person.slug, `chat:${chatId}:${crypto.randomUUID()}`)) === "ok";
  if (answered) {
    await db().from("ai_chat_messages").insert([
      { chat_id: chatId, role: "user", content: message, paid },
      { chat_id: chatId, role: "assistant", content: reply },
    ]);
    await db().from("ai_chats").update({ updated_at: new Date().toISOString() }).eq("id", chatId);
    await touchHabit(viewer.id);
    await trackEvent({ viewerHmac: viewer.phoneHmac, name: "person_chat", props: { person: person.slug, paid } });
  }
  return { ok: true, reply, suggestions, state: await chatState(tenantId, viewer.id, person) };
}

/** Chats older than 30 days are removed (cron). */
export async function pruneChats(): Promise<number> {
  const { count } = await db().from("ai_chat_messages").delete({ count: "exact" }).lt("created_at", new Date(Date.now() - HISTORY_DAYS * 86400_000).toISOString());
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Daily: card, question, horoscope, streak.
// ---------------------------------------------------------------------------

export type Today = {
  day: string;
  card: { card: number; reversed: boolean; drawn: boolean };
  question: { index: number; answer: number | null; results: { total: number; rows: Tally[] } | null };
  sign: Sign | null;
  horoscope: { ar: string; en: string; luckyNumber: number; moodAr: string; moodEn: string } | null;
  streak: number;
  /** Ping earned today for reaching a streak milestone (0 if none). */
  streakPing: number;
  next: { day: number; ping: number; left: number } | null;
  readingPing: number;
};

export async function horoscopeFor(tenantId: string, sign: Sign, day = playDay()): Promise<NonNullable<Today["horoscope"]>> {
  const { data } = await db().from("horoscopes").select("text_ar, text_en, extra").eq("tenant_id", tenantId).eq("sign", sign).eq("day", day).eq("status", "approved").maybeSingle();
  if (data?.text_ar) {
    const ex = (data.extra ?? {}) as { luckyNumber?: number; moodAr?: string; moodEn?: string };
    return { ar: data.text_ar as string, en: data.text_en as string, luckyNumber: ex.luckyNumber ?? 7, moodAr: ex.moodAr ?? "", moodEn: ex.moodEn ?? "" };
  }
  const f = fallbackHoroscope(sign, day);
  return { ...f, moodAr: "", moodEn: "" };
}

async function questionResults(tenantId: string, day: string) {
  const { data } = await db().from("daily_draws").select("pick").eq("tenant_id", tenantId).eq("kind", "question").eq("day", day).limit(50000);
  const counts: Record<string, number> = {};
  for (const d of data ?? []) counts[String(d.pick)] = (counts[String(d.pick)] ?? 0) + 1;
  const q = questionOfDay(day).q;
  return tally(q.options.map((_, i) => ({ id: String(i), ar: "", en: "" })), counts);
}

export async function todayFor(tenantId: string, viewerId: string): Promise<Today> {
  const day = playDay();
  const [{ data: draws }, { data: v }, habit, settings] = await Promise.all([
    db().from("daily_draws").select("kind, pick, reversed").eq("viewer_id", viewerId).eq("day", day),
    db().from("viewers").select("star_sign").eq("id", viewerId).maybeSingle(),
    habitDays(viewerId, day),
    playSettings(tenantId),
  ]);
  const days = streak(habit, day);
  const milestone = habit.includes(day) ? streakReward(days, settings.streakRewards) : 0;
  const cardDraw = (draws ?? []).find((d) => d.kind === "card");
  const qDraw = (draws ?? []).find((d) => d.kind === "question");
  const fate = cardOfDay(viewerId, day);
  const sign = isSign(v?.star_sign) ? v.star_sign : null;
  const { index } = questionOfDay(day);
  return {
    day,
    card: { card: cardDraw ? (cardDraw.pick as number) : fate.card, reversed: cardDraw ? (cardDraw.reversed as boolean) : fate.reversed, drawn: Boolean(cardDraw) },
    question: { index, answer: qDraw ? (qDraw.pick as number) : null, results: qDraw ? await questionResults(tenantId, day) : null },
    sign,
    horoscope: sign ? await horoscopeFor(tenantId, sign, day) : null,
    streak: days,
    streakPing: milestone,
    next: nextMilestone(days, settings.streakRewards),
    readingPing: settings.readingPing,
  };
}

export async function drawCard(tenantId: string, viewer: SessionViewer): Promise<Today> {
  const day = playDay();
  const fate = cardOfDay(viewer.id, day);
  const { error } = await db().from("daily_draws").insert({ viewer_id: viewer.id, tenant_id: tenantId, day, kind: "card", pick: fate.card, reversed: fate.reversed });
  if (!error) {
    await touchHabit(viewer.id, day);
    await trackEvent({ viewerHmac: viewer.phoneHmac, name: "card_draw", props: { card: fate.card, reversed: fate.reversed } });
  }
  return todayFor(tenantId, viewer.id);
}

export async function answerQuestion(tenantId: string, viewer: SessionViewer, pick: number): Promise<Today | null> {
  const day = playDay();
  const { q } = questionOfDay(day);
  if (!Number.isInteger(pick) || pick < 0 || pick >= q.options.length) return null;
  const { error } = await db().from("daily_draws").insert({ viewer_id: viewer.id, tenant_id: tenantId, day, kind: "question", pick });
  if (!error) {
    await touchHabit(viewer.id, day);
    await trackEvent({ viewerHmac: viewer.phoneHmac, name: "daily_question", props: { pick } });
  }
  return todayFor(tenantId, viewer.id);
}

export async function setSign(viewer: SessionViewer, sign: Sign): Promise<void> {
  await db().from("viewers").update({ star_sign: sign }).eq("id", viewer.id);
  await trackEvent({ viewerHmac: viewer.phoneHmac, name: "sign_set", props: { sign } });
}

export type Reading = { id: string; question: string; cards: { card: number; reversed: boolean }[]; text: string; at: string };

export async function myReadings(viewerId: string, limit = 5): Promise<Reading[]> {
  const { data } = await db().from("tarot_readings").select("id, question, cards, text, created_at").eq("viewer_id", viewerId).order("created_at", { ascending: false }).limit(limit);
  return (data ?? []).map((r) => ({ id: r.id as string, question: r.question as string, cards: r.cards as Reading["cards"], text: r.text as string, at: r.created_at as string }));
}

export type ReadingResult = { ok: true; reading: Reading; balance: number } | { ok: false; error: "need_ping" | "slow_down"; cost?: number };

export async function buyReading(tenantId: string, viewer: SessionViewer, question: string): Promise<ReadingResult> {
  if (!(await allow(`reading:${viewer.id}`, 10, 3600))) return { ok: false, error: "slow_down" };
  const settings = await playSettings(tenantId);
  const cost = settings.readingPing;
  const balance = await getBalance(viewer.id);
  if (cost > 0 && balance < cost) return { ok: false, error: "need_ping", cost };
  const day = playDay();
  const { count } = await db().from("tarot_readings").select("id", { count: "exact", head: true }).eq("viewer_id", viewer.id);
  const picks = readingCards(viewer.id, day, count ?? 0);
  const cards = picks.map((p) => ({ card: cardById(p.card), reversed: p.reversed }));
  const q = question.trim().slice(0, 300);
  let text = readingWithoutAi(cards, viewer.uiLocale);
  const account = await playAccount(tenantId, settings.peopleDailyAiCap);
  if (account.ok) {
    try {
      const r = await callTool({ apiKey: account.apiKey, model: account.model, system: readingPrompt(cards, q, viewer.uiLocale), turns: [{ role: "user", content: "Give the reading." }], tool: READING_TOOL, maxTokens: 700 });
      await logAiUsage({ tenantId, adminId: null, purpose: "fortune", model: account.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, ok: true });
      const t = (r.input as { text?: unknown })?.text;
      if (typeof t === "string" && t.trim()) text = t.trim().slice(0, 6000);
    } catch (e) {
      await logAiUsage({ tenantId, adminId: null, purpose: "fortune", model: account.model, ok: false, error: e instanceof AiError ? e.message : "failed" });
    }
  }
  const id = crypto.randomUUID();
  if (cost > 0) {
    const paid = await spendPing(viewer.id, cost, "reading", id, `reading:${id}`);
    if (paid === "insufficient") return { ok: false, error: "need_ping", cost };
  }
  const { data } = await db().from("tarot_readings").insert({ id, tenant_id: tenantId, viewer_id: viewer.id, question: q, cards: picks, text, lang: viewer.uiLocale }).select("created_at").single();
  await touchHabit(viewer.id, day);
  await trackEvent({ viewerHmac: viewer.phoneHmac, name: "reading_bought", props: { cost } });
  return { ok: true, reading: { id, question: q, cards: picks, text, at: (data?.created_at as string) ?? new Date().toISOString() }, balance: await getBalance(viewer.id) };
}

/** Draft (or redraft) the 12 horoscopes for a day. Approved ones are never overwritten. */
export async function draftHoroscopes(tenantId: string, adminId: string | null, day: string, brief = ""): Promise<{ drafted: number; error?: string }> {
  const account = await aiAccount(tenantId);
  if (!account.ok) return { drafted: 0, error: account.reason };
  const settings = await playSettings(tenantId);
  try {
    const r = await callTool({ apiKey: account.apiKey, model: account.model, system: horoscopePrompt(day, brief), turns: [{ role: "user", content: `Write the 12 readings for ${day}.` }], tool: HOROSCOPE_TOOL, maxTokens: 5000 });
    await logAiUsage({ tenantId, adminId, purpose: "horoscope", model: account.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, ok: true });
    const drafts = parseHoroscopes(r.input);
    const { data: approved } = await db().from("horoscopes").select("sign").eq("tenant_id", tenantId).eq("day", day).eq("status", "approved");
    const keep = new Set((approved ?? []).map((a) => a.sign as string));
    const now = new Date().toISOString();
    const rows = drafts
      .filter((d) => !keep.has(d.sign))
      .map((d) => ({
        tenant_id: tenantId,
        sign: d.sign,
        day,
        text_ar: d.ar,
        text_en: d.en,
        extra: { luckyNumber: d.luckyNumber, moodAr: d.moodAr, moodEn: d.moodEn },
        status: settings.horoscopeAutoApprove ? "approved" : "draft",
        source: "ai",
        approved_at: settings.horoscopeAutoApprove ? now : null,
      }));
    if (rows.length) {
      const { error } = await db().from("horoscopes").upsert(rows, { onConflict: "tenant_id,sign,day" });
      if (error) return { drafted: 0, error: error.message };
    }
    return { drafted: rows.length };
  } catch (e) {
    await logAiUsage({ tenantId, adminId, purpose: "horoscope", model: account.model, ok: false, error: e instanceof AiError ? e.message : "failed" });
    return { drafted: 0, error: e instanceof Error ? e.message : "The AI couldn't write the horoscopes right now." };
  }
}

// ---------------------------------------------------------------------------
// Weekly score (right answers in Who Is Lying / Guess the Mystery rooms) and the morning reminder.
// ---------------------------------------------------------------------------

export type WeeklyScore = { correct: number; rank: number | null; players: number; since: string };

async function weekScores(tenantId: string, since: string, until?: string): Promise<Map<string, number>> {
  let q = db()
    .from("room_answers")
    .select("viewer_id, room_rounds!inner(tenant_id)")
    .eq("room_rounds.tenant_id", tenantId)
    .eq("correct", true)
    .gte("created_at", new Date(`${since}T00:00:00+04:00`).toISOString());
  if (until) q = q.lt("created_at", new Date(`${until}T00:00:00+04:00`).toISOString());
  const { data } = await q.limit(100000);
  const by = new Map<string, number>();
  for (const a of data ?? []) by.set(a.viewer_id as string, (by.get(a.viewer_id as string) ?? 0) + 1);
  return by;
}

/** Cron: pay last week's jackpot (once per winner per week, through grant_reward). */
export async function awardWeeklyPrize(tenantId: string): Promise<{ winners: number; ping: number } | string> {
  const settings = await playSettings(tenantId);
  if (settings.weeklyPrizePing <= 0) return "off";
  const thisWeek = weekStart(playDay());
  const lastWeek = addDays(thisWeek, -7);
  const winners = weeklyWinners(await weekScores(tenantId, lastWeek, thisWeek));
  let paid = 0;
  for (const id of winners) {
    if (await grantPing(id, settings.weeklyPrizePing, "weekly_prize", `weekly:${lastWeek}:${id}`)) paid += 1;
  }
  return { winners: paid, ping: settings.weeklyPrizePing };
}

/** A live room the viewer hasn't answered today (random), else any live room. */
export async function quickMatch(tenantId: string, viewerId: string): Promise<string | null> {
  const rooms = (await liveRooms(tenantId, viewerId)).filter((r) => r.round);
  const open = rooms.filter((r) => !r.answered);
  const pool = open.length ? open : rooms;
  return pool.length ? pool[Math.floor(Math.random() * pool.length)].slug : null;
}

export async function weeklyScore(tenantId: string, viewerId: string): Promise<WeeklyScore> {
  const since = weekStart(playDay());
  const by = await weekScores(tenantId, since);
  const mine = by.get(viewerId) ?? 0;
  const rank = mine > 0 ? [...by.values()].filter((n) => n > mine).length + 1 : null;
  return { correct: mine, rank, players: by.size, since };
}

/** Morning reminder by web push: once a day per viewer with alerts on, from the chosen Gulf hour. */
export async function runMorningPush(tenantId: string, batch = 200): Promise<{ sent: number; skipped: string | null }> {
  const settings = await playSettings(tenantId);
  if (!settings.morningPush) return { sent: 0, skipped: "off" };
  const hour = playHour();
  if (hour < settings.morningHour || hour >= 22) return { sent: 0, skipped: "not_time" };
  const day = playDay();
  const { data: subs } = await db()
    .from("push_subscriptions")
    .select("viewer_id, viewers!inner(tenant_id, ui_locale, star_sign)")
    .eq("viewers.tenant_id", tenantId)
    .is("revoked_at", null)
    .limit(20000);
  const viewers = new Map<string, { locale: "ar" | "en"; sign: Sign | null }>();
  for (const s of (subs ?? []) as unknown as { viewer_id: string; viewers: { ui_locale: string; star_sign: string | null } }[]) {
    viewers.set(s.viewer_id, { locale: s.viewers.ui_locale === "en" ? "en" : "ar", sign: isSign(s.viewers.star_sign) ? s.viewers.star_sign : null });
  }
  if (!viewers.size) return { sent: 0, skipped: null };
  const { data: done } = await db().from("play_pushes").select("viewer_id").eq("tenant_id", tenantId).eq("day", day).eq("kind", "morning").limit(20000);
  const already = new Set((done ?? []).map((d) => d.viewer_id as string));
  // Skip viewers who already opened the Playground today: they don't need reminding.
  const { data: active } = await db().from("habit_days").select("viewer_id").eq("day", day).in("viewer_id", [...viewers.keys()].slice(0, 5000));
  const visited = new Set((active ?? []).map((a) => a.viewer_id as string));
  const due = [...viewers.entries()].filter(([id]) => !already.has(id) && !visited.has(id)).slice(0, batch);
  let sent = 0;
  for (const [viewerId, v] of due) {
    // Claim first: a second tick sees the row and skips.
    const { data: claim } = await db().from("play_pushes").upsert({ viewer_id: viewerId, tenant_id: tenantId, day, kind: "morning" }, { onConflict: "viewer_id,kind,day", ignoreDuplicates: true }).select("viewer_id");
    if (!claim?.length) continue;
    const msg = morningPush(v.sign, v.locale);
    const ok = await sendPush(tenantId, viewerId, { ...msg, tag: `morning-${day}` }).catch(() => false);
    await db().from("play_pushes").update({ delivered: ok }).eq("viewer_id", viewerId).eq("kind", "morning").eq("day", day);
    if (ok) sent += 1;
  }
  return { sent, skipped: null };
}

// ---------------------------------------------------------------------------
// Home page content and live numbers.
// ---------------------------------------------------------------------------

export async function homeContent(tenantId: string): Promise<HomeContent> {
  const { data } = await db().from("home_content").select("content").eq("tenant_id", tenantId).maybeSingle();
  return sanitizeHome(data?.content ?? {});
}

/** Viewers who opened the Playground today (Gulf time). */
export async function activeToday(tenantId: string): Promise<number> {
  const { count } = await db().from("habit_days").select("viewer_id, viewers!inner(tenant_id)", { count: "exact", head: true }).eq("viewers.tenant_id", tenantId).eq("day", playDay());
  return count ?? 0;
}

/** Cron: make sure tomorrow's horoscopes are drafted (once), and prune old chats. */
export async function runPlayCron(tenantId: string): Promise<Record<string, unknown>> {
  const tomorrow = addDays(playDay(), 1);
  const { count } = await db().from("horoscopes").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("day", tomorrow);
  let horoscopes: unknown = "ready";
  if ((count ?? 0) < 12) {
    // Try at most once an hour.
    horoscopes = (await allow(`horoscope-draft:${tenantId}:${tomorrow}`, 1, 3600)) ? await draftHoroscopes(tenantId, null, tomorrow) : "waiting";
  }
  const pruned = await pruneChats();
  let morning: unknown = "skipped";
  try {
    morning = await runMorningPush(tenantId);
  } catch (e) {
    morning = e instanceof Error ? e.message : "morning push failed";
  }
  let jackpot: unknown = "skipped";
  try {
    jackpot = await awardWeeklyPrize(tenantId);
  } catch (e) {
    jackpot = e instanceof Error ? e.message : "jackpot failed";
  }
  return { horoscopes, pruned, morning, jackpot };
}
