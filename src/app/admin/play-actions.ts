"use server";

// Admin → Rooms, AI People and Daily (horoscope approvals, Fortune Teller price). Everything a viewer sees in the
// Playground is set here; rooms and people are configuration, not code.

import { revalidatePath } from "next/cache";
import { audit, requireAdmin } from "@/lib/admin/auth";
import { bool, done, int, str, uuid } from "@/lib/admin/forms";
import { isSign, parseStreakRewards } from "@/lib/daily/daily";
import { sanitizePerson } from "@/lib/people/persona";
import { addStarterPeople, addStarterRooms, draftHoroscopes, draftRounds, personRow } from "@/lib/play/store";
import { isMechanic, MECHANICS, roundIssues, sanitizeConfig, sanitizeRound, type Mechanic } from "@/lib/rooms/engine";
import { db } from "@/lib/supabase";

const ROOMS = "/admin/rooms";
const PEOPLE = "/admin/people";
const DAILY = "/admin/daily";
const SLUG = /^[a-z0-9-]{2,40}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

function roomFields(fd: FormData) {
  const color = str(fd, "color", 7);
  return {
    title_ar: str(fd, "title_ar", 80),
    title_en: str(fd, "title_en", 80),
    blurb_ar: str(fd, "blurb_ar", 200),
    blurb_en: str(fd, "blurb_en", 200),
    emoji: str(fd, "emoji", 8) || "💬",
    color: /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#ff5a48",
    status: ["draft", "live", "archived"].includes(str(fd, "status")) ? str(fd, "status") : "draft",
    sort: int(fd, "sort", 0),
    config: sanitizeConfig({ results: str(fd, "results"), rewardPing: int(fd, "reward_ping", 0), aiBrief: str(fd, "ai_brief", 1000), guestAr: str(fd, "guest_ar", 80), guestEn: str(fd, "guest_en", 80) }),
    updated_at: new Date().toISOString(),
  };
}

export async function createRoomAction(fd: FormData) {
  const admin = await requireAdmin("play");
  const slug = str(fd, "slug", 40).toLowerCase();
  const mechanic = str(fd, "mechanic");
  if (!SLUG.test(slug)) done(ROOMS, "Address: 2–40 lowercase letters, numbers or dashes.", "err");
  if (!isMechanic(mechanic)) done(ROOMS, "Pick a format.", "err");
  const f = roomFields(fd);
  if (!f.title_ar || !f.title_en) done(ROOMS, "The room needs an Arabic and an English name.", "err");
  const { data, error } = await db().from("rooms").insert({ tenant_id: admin.tenantId, slug, mechanic, ...f, status: "draft" }).select("id").single();
  if (error || !data) done(ROOMS, error?.code === "23505" ? "That address is taken." : `Save failed: ${error?.message}`, "err");
  await audit(admin, "room.created", "room", data.id, { slug, mechanic });
  done(`${ROOMS}/${data.id}`, "Room created. Add rounds, then set it live.");
}

export async function saveRoomAction(fd: FormData) {
  const admin = await requireAdmin("play");
  const id = uuid(fd, "id");
  if (!id) done(ROOMS, "Room not found.", "err");
  const back = `${ROOMS}/${id}`;
  const f = roomFields(fd);
  if (!f.title_ar || !f.title_en) done(back, "The room needs an Arabic and an English name.", "err");
  if (f.status === "live") {
    const { count } = await db().from("room_rounds").select("id", { count: "exact", head: true }).eq("room_id", id).eq("status", "approved");
    if (!count) done(back, "Approve at least one round before setting the room live.", "err");
  }
  const { error } = await db().from("rooms").update(f).eq("id", id).eq("tenant_id", admin.tenantId);
  if (error) done(back, `Save failed: ${error.message}`, "err");
  await audit(admin, "room.saved", "room", id, { status: f.status });
  revalidatePath("/rooms");
  done(back, "Room saved.");
}

export async function addStarterRoomsAction() {
  const admin = await requireAdmin("play");
  const n = await addStarterRooms(admin.tenantId, false);
  await audit(admin, "room.starters_added", "room", null, { added: n });
  done(ROOMS, n ? `${n} starter rooms added.` : "The starter rooms are already here.");
}

async function roomOf(tenantId: string, id: string | null): Promise<{ id: string; mechanic: Mechanic } | null> {
  if (!id) return null;
  const { data } = await db().from("rooms").select("id, mechanic").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  return data && isMechanic(data.mechanic) ? { id: data.id as string, mechanic: data.mechanic } : null;
}

function roundFromForm(mechanic: Mechanic, fd: FormData) {
  const spec = MECHANICS[mechanic];
  const correct = str(fd, "correct", 4);
  const options = Array.from({ length: spec.maxOptions }, (_, i) => ({
    ar: str(fd, `opt_ar_${i}`, 160),
    en: str(fd, `opt_en_${i}`, 160),
    correct: spec.oneCorrect ? correct === String(i) : undefined,
    revealAr: str(fd, `rev_ar_${i}`, 600),
    revealEn: str(fd, `rev_en_${i}`, 600),
  }));
  const lines = (k: string) => str(fd, k, 2000).split("\n").map((l) => l.trim()).filter(Boolean);
  return sanitizeRound(mechanic, {
    promptAr: str(fd, "prompt_ar", 400),
    promptEn: str(fd, "prompt_en", 400),
    options,
    extra: { cluesAr: lines("clues_ar"), cluesEn: lines("clues_en"), explainAr: str(fd, "explain_ar", 400), explainEn: str(fd, "explain_en", 400) },
  });
}

export async function saveRoundAction(fd: FormData) {
  const admin = await requireAdmin("play");
  const room = await roomOf(admin.tenantId, uuid(fd, "room_id"));
  if (!room) done(ROOMS, "Room not found.", "err");
  const back = `${ROOMS}/${room.id}`;
  const roundId = uuid(fd, "round_id");
  const day = str(fd, "day", 10);
  if (!DAY.test(day)) done(back, "Pick the day this round runs.", "err");
  const round = roundFromForm(room.mechanic, fd);
  const approve = str(fd, "intent") === "approve";
  if (approve) {
    const issues = roundIssues(room.mechanic, round);
    if (issues.length) done(back, `Not approved: ${issues.join(" ")}`, "err");
  }
  // A round viewers already answered keeps its answers' option ids: only texts change.
  if (roundId) {
    const { count } = await db().from("room_answers").select("round_id", { count: "exact", head: true }).eq("round_id", roundId);
    const { data: old } = await db().from("room_rounds").select("options").eq("id", roundId).maybeSingle();
    if ((count ?? 0) > 0 && ((old?.options as unknown[]) ?? []).length !== round.options.length) done(back, "Viewers already answered this round: keep the same number of answers.", "err");
  }
  const row = { prompt_ar: round.promptAr, prompt_en: round.promptEn, options: round.options, extra: round.extra, day, ...(approve ? { status: "approved" } : {}) };
  const { error } = roundId
    ? await db().from("room_rounds").update(row).eq("id", roundId).eq("room_id", room.id)
    : await db().from("room_rounds").insert({ ...row, tenant_id: admin.tenantId, room_id: room.id, status: approve ? "approved" : "draft", source: "team" });
  if (error) done(back, error.code === "23505" ? "This room already has a round on that day." : `Save failed: ${error.message}`, "err");
  await audit(admin, approve ? "round.approved" : "round.saved", "room", room.id, { day });
  revalidatePath("/rooms");
  done(back, approve ? "Round approved." : "Round saved as a draft.");
}

export async function approveRoundsAction(fd: FormData) {
  const admin = await requireAdmin("play");
  const room = await roomOf(admin.tenantId, uuid(fd, "room_id"));
  if (!room) done(ROOMS, "Room not found.", "err");
  const back = `${ROOMS}/${room.id}`;
  const { data } = await db().from("room_rounds").select("*").eq("room_id", room.id).eq("status", "draft");
  const ok = (data ?? []).filter((r) => roundIssues(room.mechanic, sanitizeRound(room.mechanic, { promptAr: r.prompt_ar, promptEn: r.prompt_en, options: r.options, extra: r.extra })).length === 0);
  if (ok.length) await db().from("room_rounds").update({ status: "approved" }).in("id", ok.map((r) => r.id));
  await audit(admin, "round.approved_all", "room", room.id, { approved: ok.length });
  done(back, `${ok.length} draft rounds approved${(data?.length ?? 0) > ok.length ? `; ${(data?.length ?? 0) - ok.length} need fixing first` : ""}.`);
}

export async function deleteRoundAction(fd: FormData) {
  const admin = await requireAdmin("play");
  const room = await roomOf(admin.tenantId, uuid(fd, "room_id"));
  const roundId = uuid(fd, "round_id");
  if (!room || !roundId) done(ROOMS, "Round not found.", "err");
  const back = `${ROOMS}/${room.id}`;
  const { count } = await db().from("room_answers").select("round_id", { count: "exact", head: true }).eq("round_id", roundId);
  if ((count ?? 0) > 0) done(back, "Viewers already answered this round, so it stays (answers are kept).", "err");
  await db().from("room_rounds").delete().eq("id", roundId).eq("room_id", room.id);
  await audit(admin, "round.deleted", "room", room.id, { round: roundId });
  done(back, "Round removed.");
}

export async function draftRoundsAction(fd: FormData) {
  const admin = await requireAdmin("play");
  const room = await roomOf(admin.tenantId, uuid(fd, "room_id"));
  if (!room) done(ROOMS, "Room not found.", "err");
  const count = Math.min(Math.max(int(fd, "count", 7), 1), 14);
  const r = await draftRounds(admin.tenantId, admin.id, room.id, count);
  await audit(admin, "round.ai_drafted", "room", room.id, { added: r.added });
  done(`${ROOMS}/${room.id}`, r.error ? `AI: ${r.error}` : `${r.added} draft rounds written. Check them and approve.`, r.error ? "err" : "ok");
}

// ---------------------------------------------------------------------------
// AI People
// ---------------------------------------------------------------------------

function personFromForm(fd: FormData) {
  const starters = str(fd, "starters", 2000)
    .split("\n")
    .map((l) => l.split("|").map((x) => x.trim()))
    .filter((p) => p[0] && p[1])
    .map(([ar, en]) => ({ ar, en }));
  return sanitizePerson({
    nameAr: str(fd, "name_ar"),
    nameEn: str(fd, "name_en"),
    roleAr: str(fd, "role_ar"),
    roleEn: str(fd, "role_en"),
    emoji: str(fd, "emoji"),
    color: str(fd, "color"),
    persona: str(fd, "persona"),
    greetingAr: str(fd, "greeting_ar"),
    greetingEn: str(fd, "greeting_en"),
    starters,
    freePerDay: int(fd, "free_per_day", 10),
    pingPerMessage: int(fd, "ping_per_message", 1),
  });
}

export async function savePersonAction(fd: FormData) {
  const admin = await requireAdmin("play");
  const id = uuid(fd, "id");
  const p = personFromForm(fd);
  if (!p.nameAr || !p.nameEn || !p.persona) done(PEOPLE, "Each AI person needs Arabic and English names and a personality.", "err");
  if (!/ذكاء اصطناعي/.test(p.greetingAr) || !/\bAI\b/i.test(p.greetingEn)) done(PEOPLE, "The greeting must say it's an AI character (Arabic: «ذكاء اصطناعي», English: “AI”).", "err");
  const status = str(fd, "status") === "live" ? "live" : "draft";
  const row = { ...personRow(p), status, sort: int(fd, "sort", 0) };
  if (id) {
    const { error } = await db().from("ai_people").update(row).eq("id", id).eq("tenant_id", admin.tenantId);
    if (error) done(PEOPLE, `Save failed: ${error.message}`, "err");
    await audit(admin, "person.saved", "ai_person", id, { status });
  } else {
    const slug = str(fd, "slug", 40).toLowerCase();
    if (!SLUG.test(slug)) done(PEOPLE, "Address: 2–40 lowercase letters, numbers or dashes.", "err");
    const { data, error } = await db().from("ai_people").insert({ tenant_id: admin.tenantId, slug, ...row }).select("id").single();
    if (error) done(PEOPLE, error.code === "23505" ? "That address is taken." : `Save failed: ${error.message}`, "err");
    await audit(admin, "person.created", "ai_person", data?.id ?? null, { slug });
  }
  revalidatePath("/people");
  done(PEOPLE, "Saved.");
}

export async function addStarterPeopleAction() {
  const admin = await requireAdmin("play");
  const n = await addStarterPeople(admin.tenantId, false);
  await audit(admin, "person.starters_added", "ai_person", null, { added: n });
  done(PEOPLE, n ? `${n} starter AI people added.` : "The starter AI people are already here.");
}

// ---------------------------------------------------------------------------
// Daily: settings, horoscopes
// ---------------------------------------------------------------------------

export async function savePlaySettingsAction(fd: FormData) {
  const admin = await requireAdmin("play");
  const back = str(fd, "back", 40) === "people" ? PEOPLE : DAILY;
  const { data: cur } = await db().from("playground_settings").select("*").eq("tenant_id", admin.tenantId).maybeSingle();
  const row = {
    tenant_id: admin.tenantId,
    reading_ping: fd.has("reading_ping") ? Math.min(Math.max(int(fd, "reading_ping", 20), 0), 10000) : (cur?.reading_ping ?? 20),
    people_daily_ai_cap: fd.has("people_daily_ai_cap") ? Math.min(Math.max(int(fd, "people_daily_ai_cap", 2000), 0), 1000000) : (cur?.people_daily_ai_cap ?? 2000),
    horoscope_auto_approve: fd.has("horoscope_form") ? bool(fd, "horoscope_auto_approve") : (cur?.horoscope_auto_approve ?? false),
    streak_rewards: fd.has("streak_rewards") ? parseStreakRewards(str(fd, "streak_rewards", 400)) : (cur?.streak_rewards ?? { 3: 5, 7: 15, 14: 25, 30: 60 }),
    morning_push: fd.has("horoscope_form") ? bool(fd, "morning_push") : (cur?.morning_push ?? true),
    morning_hour: fd.has("morning_hour") ? Math.min(Math.max(int(fd, "morning_hour", 8), 5), 12) : (cur?.morning_hour ?? 8),
    updated_at: new Date().toISOString(),
  };
  const { error } = await db().from("playground_settings").upsert(row);
  if (error) done(back, `Save failed: ${error.message}`, "err");
  await audit(admin, "play.settings_saved", "playground", null, row);
  done(back, "Settings saved.");
}

export async function saveHoroscopeAction(fd: FormData) {
  const admin = await requireAdmin("play");
  const day = str(fd, "day", 10);
  const sign = str(fd, "sign", 20);
  const back = `${DAILY}?day=${day}`;
  if (!DAY.test(day) || !isSign(sign)) done(DAILY, "Pick a day and a sign.", "err");
  const textAr = str(fd, "text_ar", 800);
  const textEn = str(fd, "text_en", 800);
  if (!textAr || !textEn) done(back, "The reading needs Arabic and English.", "err");
  const lucky = Math.min(Math.max(int(fd, "lucky", 7), 1), 99);
  const approve = str(fd, "intent") === "approve";
  const { error } = await db()
    .from("horoscopes")
    .upsert(
      {
        tenant_id: admin.tenantId,
        sign,
        day,
        text_ar: textAr,
        text_en: textEn,
        extra: { luckyNumber: lucky, moodAr: str(fd, "mood_ar", 30), moodEn: str(fd, "mood_en", 30) },
        status: approve ? "approved" : "draft",
        approved_by: approve ? admin.id : null,
        approved_at: approve ? new Date().toISOString() : null,
      },
      { onConflict: "tenant_id,sign,day" },
    );
  if (error) done(back, `Save failed: ${error.message}`, "err");
  await audit(admin, approve ? "horoscope.approved" : "horoscope.saved", "horoscope", null, { sign, day });
  done(back, approve ? "Approved." : "Saved as a draft.");
}

export async function approveAllHoroscopesAction(fd: FormData) {
  const admin = await requireAdmin("play");
  const day = str(fd, "day", 10);
  if (!DAY.test(day)) done(DAILY, "Pick a day.", "err");
  const { data } = await db()
    .from("horoscopes")
    .update({ status: "approved", approved_by: admin.id, approved_at: new Date().toISOString() })
    .eq("tenant_id", admin.tenantId)
    .eq("day", day)
    .eq("status", "draft")
    .neq("text_ar", "")
    .neq("text_en", "")
    .select("id");
  await audit(admin, "horoscope.approved_all", "horoscope", null, { day, approved: data?.length ?? 0 });
  done(`${DAILY}?day=${day}`, `${data?.length ?? 0} readings approved.`);
}

export async function draftHoroscopesAction(fd: FormData) {
  const admin = await requireAdmin("play");
  const day = str(fd, "day", 10);
  if (!DAY.test(day)) done(DAILY, "Pick a day.", "err");
  const r = await draftHoroscopes(admin.tenantId, admin.id, day, str(fd, "brief", 500));
  await audit(admin, "horoscope.ai_drafted", "horoscope", null, { day, drafted: r.drafted });
  done(`${DAILY}?day=${day}`, r.error ? `AI: ${r.error}` : `${r.drafted} readings drafted. Check and approve them.`, r.error ? "err" : "ok");
}
