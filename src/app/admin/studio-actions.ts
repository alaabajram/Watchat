"use server";

// Admin → Studio: briefs, review stages and notes, publishing, the OpenArt credit budget, the Claude connector
// keys and the series bible. Claude's side is the connector (src/lib/studio/tools.ts); it can never publish.

import { revalidatePath } from "next/cache";
import { audit, requireAdmin } from "@/lib/admin/auth";
import { done, int, str, uuid } from "@/lib/admin/forms";
import { randomToken, sha256Hex } from "@/lib/crypto";
import { siteUrl } from "@/lib/site/store";
import { suggestCode } from "@/lib/admin/readiness";
import { LANGS, originalLang } from "@/lib/storage/tracks";
import { AUDIO_REF, STORY_STYLES } from "@/lib/story/types";
import { sanitizeBible } from "@/lib/studio/bible";
import { AUDIO_KINDS, audioRates } from "@/lib/studio/budget";
import { ARTWORK_CAP_DEFAULT, artSlot, sanitizeProposals, STUDIO_ART } from "@/lib/studio/artwork";
import { deleteStored } from "@/lib/storage/cloudflare";
import { addNote, canMove, isStage, sanitizeNotes, STAGE_INFO } from "@/lib/studio/stages";
import { sanitizeStory } from "@/lib/story/sanitize";
import { clearAudio } from "@/lib/story/import";
import { db } from "@/lib/supabase";
import { publishStory } from "./story-actions";

const BOARD = "/admin/studio";
const page = (episodeId: string) => `/admin/studio/${episodeId}`;

async function ownEpisode(tenantId: string, episodeId: string) {
  const { data: ep } = await db().from("episodes").select("id, number, series_id, story_draft, series!inner(tenant_id, code, format)").eq("id", episodeId).maybeSingle();
  const s = (ep as unknown as { series?: { tenant_id: string; code: string; format: string } } | null)?.series;
  if (!ep || !s || s.tenant_id !== tenantId) done(BOARD, "Episode not found.", "err");
  return { ep: ep!, series: s! };
}

/** Open an episode in the Studio with a brief (creates the episode when it doesn't exist yet). */
export async function createBriefAction(fd: FormData) {
  const admin = await requireAdmin("content");
  const seriesId = uuid(fd, "series_id");
  const brief = str(fd, "brief", 4000);
  if (!seriesId || !brief) done(BOARD, "Pick a series and write the brief.", "err");
  const { data: s } = await db().from("series").select("id, code, format").eq("id", seriesId).eq("tenant_id", admin.tenantId).maybeSingle();
  if (!s) done(BOARD, "Series not found.", "err");
  if (s.format !== "story") done(BOARD, `${s.code} is a video series. Turn it into a story series in its Story builder tab first.`, "err");

  let number = int(fd, "episode", 0);
  if (number < 1) {
    const { data: last } = await db().from("episodes").select("number").eq("series_id", s.id).order("number", { ascending: false }).limit(1).maybeSingle();
    number = (last?.number ?? 0) + 1;
  }
  let { data: ep } = await db().from("episodes").select("id").eq("series_id", s.id).eq("number", number).maybeSingle();
  if (!ep) {
    const { data, error } = await db()
      .from("episodes")
      .insert({ series_id: s.id, number, title_ar: `الحلقة ${number}`, title_en: `Episode ${number}`, status: "draft" })
      .select("id")
      .single();
    if (error || !data) done(BOARD, "Couldn't create the episode.", "err");
    ep = data;
  }
  const { data: existing } = await db().from("studio_items").select("stage").eq("episode_id", ep.id).maybeSingle();
  if (existing && existing.stage !== "published") done(page(ep.id), `Episode ${number} is already in the Studio.`, "err");
  await db()
    .from("studio_items")
    .upsert({ episode_id: ep.id, series_id: s.id, tenant_id: admin.tenantId, stage: "brief", brief, notes: [], credits_used: 0, updated_at: new Date().toISOString() }, { onConflict: "episode_id" });
  await audit(admin, "studio.brief", "episode", ep.id, { series: s.code, number });
  done(BOARD, `${s.code} episode ${number} is waiting for Claude. In Claude, say: "Write episode ${number} of ${s.code}".`);
}

export async function updateBriefAction(fd: FormData) {
  const admin = await requireAdmin("content");
  const id = uuid(fd, "episode_id");
  if (!id) done(BOARD, "Bad request.", "err");
  await ownEpisode(admin.tenantId, id);
  await db().from("studio_items").update({ brief: str(fd, "brief", 4000), updated_at: new Date().toISOString() }).eq("episode_id", id).eq("tenant_id", admin.tenantId);
  done(page(id), "Brief saved.");
}

/** Approve, send back with a note, or move an episode along. */
export async function moveStageAction(fd: FormData) {
  const admin = await requireAdmin("content");
  const id = uuid(fd, "episode_id");
  const to = str(fd, "to", 30);
  const note = str(fd, "note", 2000);
  if (!id || !isStage(to)) done(BOARD, "Bad request.", "err");
  await ownEpisode(admin.tenantId, id);
  const { data: item } = await db().from("studio_items").select("stage, notes").eq("episode_id", id).eq("tenant_id", admin.tenantId).maybeSingle();
  if (!item || !isStage(item.stage)) done(BOARD, "Not in the Studio.", "err");
  if (!canMove(item.stage, to)) done(page(id), `Can't go from ${STAGE_INFO[item.stage].label} to ${STAGE_INFO[to].label}.`, "err");
  const back = ["writing", "pictures"].includes(to) && ["script_review", "final_check"].includes(item.stage);
  if (back && !note) done(page(id), "Say what Claude should change (the note goes to Claude).", "err");
  const notes = note ? addNote(sanitizeNotes(item.notes), { by: admin.name ?? admin.email, who: "team", text: note, stage: to }) : sanitizeNotes(item.notes);
  await db().from("studio_items").update({ stage: to, notes, updated_at: new Date().toISOString() }).eq("episode_id", id);
  await audit(admin, "studio.stage", "episode", id, { from: item.stage, to });
  done(page(id), back ? `Sent back to Claude: ${STAGE_INFO[to].label}.` : `Moved to ${STAGE_INFO[to].label}.`);
}

/**
 * "Redo this audio" (final check): the file comes off the episode, the cue stays (so Claude's media_missing
 * lists it and it can't be resubmitted without a new file), a note goes to Claude and the episode goes back to Media.
 */
export async function redoAudioAction(fd: FormData) {
  const admin = await requireAdmin("content");
  const id = uuid(fd, "episode_id");
  const ref = str(fd, "ref", 40).toLowerCase();
  const note = str(fd, "note", 1000);
  if (!id || !AUDIO_REF.test(ref)) done(BOARD, "Bad request.", "err");
  if (!note) done(page(id), "Say what should change in the sound (the note goes to Claude).", "err");
  const { ep } = await ownEpisode(admin.tenantId, id);
  const { data: item } = await db().from("studio_items").select("stage, notes").eq("episode_id", id).eq("tenant_id", admin.tenantId).maybeSingle();
  if (!item || !isStage(item.stage)) done(BOARD, "Not in the Studio.", "err");
  if (item.stage !== "final_check" && item.stage !== "approved") done(page(id), "Sound can be sent back at the final check.", "err");
  const r = clearAudio(sanitizeStory(ep.story_draft ?? {}), ref);
  if (!r.count) done(page(id), `${ref} has no file to redo.`, "err");
  await db().from("episodes").update({ story_draft: r.story }).eq("id", id);
  const notes = addNote(sanitizeNotes(item.notes), { by: admin.name ?? admin.email, who: "team", text: `Redo ${ref}: ${note}`, stage: "pictures" });
  await db().from("studio_items").update({ stage: "pictures", notes, updated_at: new Date().toISOString() }).eq("episode_id", id);
  await audit(admin, "studio.redo_audio", "episode", id, { ref });
  done(page(id), `${ref} sent back to Claude for a redo (episode is back at Media).`);
}

export async function addNoteAction(fd: FormData) {
  const admin = await requireAdmin("content");
  const id = uuid(fd, "episode_id");
  const text = str(fd, "note", 2000);
  if (!id || !text) done(BOARD, "Write the note.", "err");
  await ownEpisode(admin.tenantId, id);
  const { data: item } = await db().from("studio_items").select("stage, notes").eq("episode_id", id).maybeSingle();
  if (!item || !isStage(item.stage)) done(BOARD, "Not in the Studio.", "err");
  const notes = addNote(sanitizeNotes(item.notes), { by: admin.name ?? admin.email, who: "team", text, stage: item.stage });
  await db().from("studio_items").update({ notes, updated_at: new Date().toISOString() }).eq("episode_id", id);
  done(page(id), "Note added; Claude sees it on its next look at the episode.");
}

/** Publish an approved episode (same checks as the Story builder's Publish). */
export async function publishFromStudioAction(fd: FormData) {
  const admin = await requireAdmin("content");
  const id = uuid(fd, "episode_id");
  if (!id) done(BOARD, "Bad request.", "err");
  const { ep } = await ownEpisode(admin.tenantId, id);
  const { data: item } = await db().from("studio_items").select("stage").eq("episode_id", id).maybeSingle();
  if (item?.stage !== "approved") done(page(id), "Approve the episode first.", "err");
  const r = await publishStory(id, sanitizeStory(ep.story_draft ?? {}));
  if (!r.ok) done(page(id), `Not published: ${r.issues.filter((i) => i.level === "error").map((i) => i.message).join(" ")}`, "err");
  done(page(id), r.live ? `Episode ${ep.number} is live (version ${r.version}).` : `Episode ${ep.number} is published; viewers see it once the series is live.`);
}

/** The OpenArt credit budget (owners only). */
export async function saveStudioSettingsAction(fd: FormData) {
  const admin = await requireAdmin("team");
  const monthly = Math.max(0, Math.min(10_000_000, int(fd, "monthly_credits", 24000)));
  const episode = Math.max(0, Math.min(1_000_000, int(fd, "episode_credits", 2500)));
  const usd = Math.max(0, Math.min(1, Number(str(fd, "usd_per_credit", 20)) || 0.0015));
  const artwork = Math.max(0, Math.min(1_000_000, int(fd, "artwork_credits", ARTWORK_CAP_DEFAULT)));
  const audio_rates = audioRates(Object.fromEntries(AUDIO_KINDS.map((k) => [k, str(fd, `audio_${k}`, 12)])));
  const { error } = await db()
    .from("studio_settings")
    .upsert({ tenant_id: admin.tenantId, monthly_credits: monthly, episode_credits: episode, artwork_credits: artwork, usd_per_credit: usd, audio_rates, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" });
  if (error) done(BOARD, `Couldn't save the budget: ${error.message}`, "err");
  await audit(admin, "studio.budget", "tenant", admin.tenantId, { monthly, episode, artwork, usd, audio_rates });
  done(BOARD, "Credit budget saved.");
}

/** A connector address for Claude (shown once; 90 days; revocable). */
export async function createConnectorAction(fd: FormData) {
  const admin = await requireAdmin("content");
  const { count } = await db().from("studio_tokens").select("id", { count: "exact", head: true }).eq("admin_id", admin.id).is("revoked_at", null);
  if ((count ?? 0) >= 5) done(BOARD, "You already have 5 connector addresses; remove one first.", "err");
  const token = randomToken(32);
  await db()
    .from("studio_tokens")
    .insert({ tenant_id: admin.tenantId, admin_id: admin.id, label: str(fd, "label", 60) || "Claude", token_hash: sha256Hex(token), expires_at: new Date(Date.now() + 90 * 86_400_000).toISOString() });
  await audit(admin, "studio.connector_created", "admin_user", admin.id);
  // Shown once. The address is the same for everyone; the key goes in the connector's request header.
  done(BOARD, `Connector address (shown once, copy it now; treat it like a password): ${await siteUrl()}/api/mcp/${token} · Check it by opening it in your browser.`);
}

export async function revokeConnectorAction(fd: FormData) {
  const admin = await requireAdmin("content");
  const id = uuid(fd, "id");
  if (!id) done(BOARD, "Bad request.", "err");
  const owner = admin.role === "owner";
  let q = db().from("studio_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", id).eq("tenant_id", admin.tenantId);
  if (!owner) q = q.eq("admin_id", admin.id);
  await q;
  await audit(admin, "studio.connector_revoked", "studio_token", id);
  done(BOARD, "Connector address removed; Claude can't use it any more.");
}

/** The series bible (style line, dialect, rules, character looks; lock once the portraits are approved). */
export async function saveBibleAction(fd: FormData) {
  const admin = await requireAdmin("content");
  const id = uuid(fd, "series_id");
  if (!id) done(BOARD, "Bad request.", "err");
  const { data: s } = await db().from("series").select("id, story_bible").eq("id", id).eq("tenant_id", admin.tenantId).maybeSingle();
  if (!s) done(BOARD, "Series not found.", "err");
  const current = sanitizeBible(s.story_bible);
  const characters = current.characters.map((c) => ({
    ...c,
    look: str(fd, `look_${c.id}`, 800) || c.look,
    portrait: fd.get(`clear_${c.id}`) === "on" ? null : c.portrait,
    voice: fd.has(`voice_${c.id}`) ? str(fd, `voice_${c.id}`, 300) : c.voice,
    voiceSample: fd.get(`clear_voice_${c.id}`) === "on" ? null : c.voiceSample,
  }));
  const theme = { desc: fd.has("theme_desc") ? str(fd, "theme_desc", 400) : current.theme.desc, url: fd.get("clear_theme") === "on" ? null : current.theme.url };
  const outline = current.outline.map((o) => ({ ...o, brief: str(fd, `outline_${o.number}`, 1500) || o.brief }));
  const bible = sanitizeBible({
    style: str(fd, "style", 800),
    dialect: str(fd, "dialect", 60),
    rules: str(fd, "rules", 6000),
    characters,
    theme,
    locked: fd.get("locked") === "on",
    brief: str(fd, "brief", 4000) || current.brief,
    planned: int(fd, "planned", current.planned),
    outline,
  });
  await db().from("series").update({ story_bible: bible }).eq("id", id);
  await audit(admin, "studio.bible", "series", id, { locked: bible.locked });
  revalidatePath(BOARD);
  done(`/admin/studio/bible/${id}`, bible.locked ? "Bible saved and locked: Claude follows it and can't change the characters." : "Bible saved.");
}

/** Start a new story series in the Studio: a draft series with the team's brief, waiting for Claude to set it up. */
export async function createStudioSeriesAction(fd: FormData) {
  const admin = await requireAdmin("content");
  const titleEn = str(fd, "title_en", 120);
  const titleAr = str(fd, "title_ar", 120);
  const brief = str(fd, "brief", 4000);
  if (!titleEn || !brief) done(BOARD, "Give the series a working title and describe the idea.", "err");
  const style = STORY_STYLES.find((x) => x.key === str(fd, "style", 20))?.key ?? "visual_novel";
  const planned = Math.min(Math.max(int(fd, "planned", 10), 1), 200);
  const lang = originalLang(str(fd, "dialect", 30) || "gulf");
  const { data: taken } = await db().from("series").select("code").eq("tenant_id", admin.tenantId);
  const code = suggestCode(titleEn, (taken ?? []).map((t) => t.code as string));
  const { data: series, error } = await db()
    .from("series")
    .insert({
      tenant_id: admin.tenantId,
      code,
      title_en: titleEn,
      title_ar: titleAr || titleEn,
      synopsis_en: brief.slice(0, 1000),
      dialect: lang,
      genres: [],
      status: "draft",
      format: "story",
      story_style: style,
      wa_episode_count: 0,
      story_bible: { brief, planned, dialect: LANGS[lang].label },
    })
    .select("id, code")
    .single();
  if (error || !series) done(BOARD, "Couldn't create the series.", "err");
  await audit(admin, "studio.series_created", "series", series.id, { code, planned });
  done(BOARD, `${series.code} created. In Claude (Watchat Studio on), say: "Set up ${series.code}". Claude writes the bible, characters, portraits and an outline of ${planned} episodes for you to review.`);
}

/** Send outline episodes to Claude: each becomes an episode with a Studio brief (stage "Brief"). */
export async function sendOutlineAction(fd: FormData) {
  const admin = await requireAdmin("content");
  const id = uuid(fd, "series_id");
  if (!id) done(BOARD, "Bad request.", "err");
  const back = `/admin/studio/bible/${id}`;
  const { data: s } = await db().from("series").select("id, code, story_bible").eq("id", id).eq("tenant_id", admin.tenantId).maybeSingle();
  if (!s) done(BOARD, "Series not found.", "err");
  const bible = sanitizeBible(s.story_bible);
  if (!bible.locked) done(back, "Lock the bible first, so every episode uses the same faces, style and rules.", "err");
  const wanted = new Set(fd.getAll("numbers").map((n) => Number(n)));
  const items = bible.outline.filter((o) => wanted.has(o.number));
  if (!items.length) done(back, "Tick the episodes to send.", "err");
  let sent = 0;
  for (const o of items) {
    let { data: ep } = await db().from("episodes").select("id").eq("series_id", s.id).eq("number", o.number).maybeSingle();
    if (!ep) {
      const { data } = await db()
        .from("episodes")
        .insert({ series_id: s.id, number: o.number, title_ar: o.title.ar || `الحلقة ${o.number}`, title_en: o.title.en || `Episode ${o.number}`, status: "draft" })
        .select("id")
        .single();
      ep = data;
    }
    if (!ep) continue;
    const { data: existing } = await db().from("studio_items").select("stage").eq("episode_id", ep.id).maybeSingle();
    if (existing) continue; // already in the Studio
    await db().from("studio_items").insert({ episode_id: ep.id, series_id: s.id, tenant_id: admin.tenantId, stage: "brief", brief: o.brief, notes: [], credits_used: 0 });
    sent++;
  }
  await audit(admin, "studio.outline_sent", "series", s.id, { numbers: items.map((o) => o.number) });
  done(BOARD, sent ? `${sent} episode(s) of ${s.code} are waiting for Claude. Say: "Write episode ${items[0].number} of ${s.code}".` : "Those episodes are already in the Studio.");
}

/** Artwork Claude made for a live series' filled slot: put it on the series ("use") or throw it away ("discard"). */
export async function artworkProposalAction(fd: FormData) {
  const admin = await requireAdmin("content");
  const seriesId = uuid(fd, "series");
  const slot = artSlot(str(fd, "slot", 20));
  const use = str(fd, "do", 10) === "use";
  if (!seriesId || !slot) done(BOARD, "Bad request.", "err");
  const { data: s } = await db().from("series").select("id, code, studio_artwork").eq("id", seriesId!).eq("tenant_id", admin.tenantId).maybeSingle();
  const proposals = sanitizeProposals(s?.studio_artwork);
  const p = proposals[slot!];
  if (!s || !p) done(BOARD, "That picture is no longer waiting.", "err");
  delete proposals[slot!];
  const field = STUDIO_ART[slot!].field;
  await db()
    .from("series")
    .update({ studio_artwork: proposals, ...(use ? { [field]: p!.url } : {}) })
    .eq("id", s!.id);
  if (!use && p!.path) await deleteStored(p!.path).catch(() => undefined);
  await audit(admin, use ? "studio.artwork_used" : "studio.artwork_discarded", "series", s!.id, { slot });
  revalidatePath("/admin/series");
  done(BOARD, use ? `${s!.code}: the new ${slot!.replace("_", " ")} is on the series.` : "Discarded.");
}
