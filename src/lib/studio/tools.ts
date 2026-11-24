// The Watchat connector's tools (Claude → Watchat Studio). Server only. Claude can read story series, keep the
// series bible, write episode scripts into drafts, reserve OpenArt credits before generating, attach the files
// and submit for review. It can never publish, and only works on episodes the team opened a brief for.

import { hostAllowed, keepMade, mediaKindOf } from "@/lib/story/import";
import { copyArtwork, copyStoryMedia, importHosts } from "@/lib/story/media-server";
import { parseStoryImport } from "@/lib/story/import";
import { audioPlan, flagsSetIn, mediaMissing } from "@/lib/story/engine";
import { sanitizeCharacters, sanitizeStory } from "@/lib/story/sanitize";
import type { Character, StoryGraph } from "@/lib/story/types";
import { validateStory } from "@/lib/story/validate";
import { copyToCloudflare } from "@/lib/storage/cloudflare";
import { randomToken } from "@/lib/crypto";
import { db } from "@/lib/supabase";
import { mergeBible, sanitizeBible, setupStatus, SETUP_LABEL, voicedCharacters, type Bible, type BiblePatch } from "./bible";
import { AUDIO_KINDS, AUDIO_RATES, audioRates, checkBudget, estimateCredits, MODEL_RATES, monthStart, type AudioKind } from "./budget";
import { ToolError, type Tool } from "./mcp";
import { ARTWORK_CAP_DEFAULT, artSlot, artworkPlacement, sanitizeProposals, STUDIO_ART, STUDIO_ART_SLOTS } from "./artwork";
import { addNote, afterSubmit, claudeMay, closeNotes, openNotes, sanitizeNotes, STAGE_INFO, isStage, type Stage } from "./stages";

export type StudioCtx = { tenantId: string; adminId: string; adminName: string };

export const STUDIO_INSTRUCTIONS = `Watchat Studio (the Watchat micro-drama platform, not any other studio): you write and illustrate episodes of Arabic-first interactive story series for the Watchat team.
Rules (cost-aware; follow them exactly):
0. Series setup: for a series listed under series_to_set_up, read watchat_get_series (the team's brief), then with watchat_save_series_bible save the style line (one sentence for every picture prompt), dialect, house rules, the characters (id, Arabic/English name, colour, a locked 40–60 word look, and for speaking characters a locked 15–30 word voice: age, tone, accent, pace), a theme-music description and an episode outline (one short brief per planned episode, cliffhanger endings). Then make ONE reference portrait per main character, ONE voice sample per speaking main character and the theme tune (reserve credits first for each, leave out the episode number) and save their file addresses with watchat_save_series_bible. Then STOP: the team reviews, locks the bible and sends the episodes to you.
1. Start with watchat_overview. Work on ONE series setup or ONE episode per conversation, and only on what is listed as waiting for you (series_to_set_up, or episodes at stage brief, writing or pictures).
2. Read watchat_get_series (bible, characters, earlier flags) and watchat_get_episode (brief, team notes) before writing. Follow the bible's style line, dialect and rules, and every open team note.
3. Writing stage: save the script with watchat_save_episode_script (pictures by image_ref; sound as cues: 1–2 music beds, ≤2 sound effects per scene, voice lines only for characters with a locked voice), fix every error it reports, then watchat_submit_for_review and STOP. Every choice must change the story: each option gets its own next scene (paths may rejoin later), or at least a different "sets" flag that a later scene branches on. Do not make any pictures or sound before the team approves the script (stage "pictures", shown as Media).
4. Media stage: BEFORE every OpenArt generation call watchat_reserve_credits with the model, kind (image|video|audio), count, and for audio the audio_kind (music|sfx|voice|lipsync) and seconds. If it refuses, stop and tell the user; never generate without an "ok". Prefer Nano Banana Pro for pictures; make at most one retake per picture or sound; reuse pictures across scenes (≤12 unique per episode); make clips only if the brief asks for them. Attach results with watchat_attach_media (file addresses named by the script: img_NN, mus_NN, sfx_NN, vo_sNN), then watchat_submit_for_review (refused while anything in media_missing is left).
5. Sound: one score per episode built on the series theme (no per-scene music changes beyond the 1–2 beds); always make a voice line from the character's voice sample as the reference, never without it; sound effects only where the brief or script marks them; dialogue follows the bible dialect, and for Arabic series make the English voice lines only if the team asks. The on-screen text stays: every voiced scene keeps its Arabic and English text.
6. Keep your messages to the user short. Never invent file addresses.
7. Series artwork (poster, banner_wide, banner_wa, square): only when the team asks for it. Read watchat_get_series for the sizes and what is already there, reserve credits with artwork set to the slot (no episode; its own per-series cap), make the picture at that slot's shape with the bible's style line (title lettering only if asked), at most one retake, then watchat_attach_artwork. On a live series a filled slot isn't replaced: it waits for the team's "Use it".`;

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const text = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

async function seriesByCode(ctx: StudioCtx, code: unknown) {
  const c = text(code, 30).toUpperCase();
  if (!/^[A-Z0-9_-]{2,30}$/.test(c)) throw new ToolError("Give the series code, e.g. HOLIDAY01 (watchat_overview lists them).");
  const { data } = await db()
    .from("series")
    .select("id, code, status, title_ar, title_en, synopsis_en, tagline_en, format, story_style, story_characters, story_bible, poster_url, banner_wide_url, banner_wa_url, square_url, studio_artwork")
    .eq("tenant_id", ctx.tenantId)
    .eq("code", c)
    .maybeSingle();
  if (!data) throw new ToolError(`No series ${c}.`);
  if (data.format !== "story") throw new ToolError(`${c} is a video series; the Studio only makes story series.`);
  return data;
}

async function episodeOf(seriesId: string, number: unknown) {
  const n = Math.round(Number(number));
  if (!Number.isInteger(n) || n < 1) throw new ToolError("Give the episode number.");
  const { data: ep } = await db().from("episodes").select("id, number, title_ar, title_en, story_draft, story").eq("series_id", seriesId).eq("number", n).maybeSingle();
  if (!ep) throw new ToolError(`Episode ${n} doesn't exist. The team opens episodes with a brief in Admin → Studio.`);
  const { data: item } = await db().from("studio_items").select("stage, brief, notes, credits_used").eq("episode_id", ep.id).maybeSingle();
  if (!item) throw new ToolError(`Episode ${n} has no Studio brief yet. Ask the team to add one in Admin → Studio.`);
  const stage: Stage = isStage(item.stage) ? item.stage : "brief";
  return { ep, item: { ...item, stage, notes: sanitizeNotes(item.notes) } };
}

async function settings(tenantId: string) {
  // "*": audio_rates arrived later (works before and after that migration).
  const { data } = await db().from("studio_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
  return { monthly: data?.monthly_credits ?? 24000, episodeCap: data?.episode_credits ?? 2500, artworkCap: data?.artwork_credits ?? ARTWORK_CAP_DEFAULT, usd: Number(data?.usd_per_credit ?? 0.0015), audio: audioRates(data?.audio_rates) };
}

/** Copy a reference file (portrait, voice sample, theme tune) from OpenArt into Watchat's storage. */
async function copyReference(code: string, name: string, url: string, kind: "image" | "audio"): Promise<string | null> {
  if (!hostAllowed(url, importHosts())) throw new ToolError(`${name}: reference files must come from OpenArt.`);
  const k = mediaKindOf(url);
  if (k && k.type !== kind) throw new ToolError(`${name}: expected ${kind === "image" ? "a picture" : "a sound (mp3, m4a or wav)"}.`);
  const ext = k?.ext ?? (kind === "image" ? "jpg" : "mp3");
  const copied = await copyToCloudflare(url, `${code}/story/${name}-${randomToken(4)}.${ext}`);
  return copied?.publicUrl ?? null;
}

const scriptChecks = (story: StoryGraph, chars: Character[], bible: Bible) => validateStory(story, { characters: chars, voices: voicedCharacters(bible) });

export async function creditsThisMonth(tenantId: string): Promise<number> {
  const { data } = await db().from("studio_credit_log").select("credits").eq("tenant_id", tenantId).gte("created_at", monthStart());
  return (data ?? []).reduce((a, r) => a + (r.credits ?? 0), 0);
}

/** Credits already reserved for a series' artwork (all time: the cap is per series). */
async function artworkCreditsUsed(seriesId: string): Promise<number> {
  const { data } = await db().from("studio_credit_log").select("credits").eq("series_id", seriesId).eq("kind", "artwork");
  return (data ?? []).reduce((a, r) => a + (r.credits ?? 0), 0);
}

/** A compact script for Claude to read (no media addresses, just whether each picture and sound is there). */
function compactScript(g: StoryGraph) {
  return {
    start: g.start,
    music: (g.music ?? []).map((b) => ({ id: b.id, desc: b.desc, mood: b.mood, has_file: Boolean(b.media) })),
    scenes: g.scenes.map((s) => ({
      id: s.id,
      name: s.name,
      image_ref: s.ref ?? null,
      has_picture: Boolean(s.image || s.video),
      speaker: s.speaker,
      text: s.text,
      motion: s.motion,
      auto: s.auto,
      route: s.route,
      ...(s.musicRef || s.stopMusic || s.sfx?.length || s.voiceRef
        ? {
            audio: {
              ...(s.musicRef ? { music: s.musicRef } : s.stopMusic ? { music: "stop" } : {}),
              ...(s.sfx?.length ? { sfx: s.sfx.map((x) => ({ id: x.id, desc: x.desc, has_file: Boolean(x.media) })) } : {}),
              ...(s.voiceRef ? { voice: { id: s.voiceRef, has_file: Boolean(s.audio) } } : {}),
            },
          }
        : {}),
    })),
  };
}


async function setItem(episodeId: string, patch: Record<string, unknown>) {
  await db().from("studio_items").update({ ...patch, updated_at: new Date().toISOString() }).eq("episode_id", episodeId);
}

const SERIES = { series: { type: "string", description: "Series code, e.g. HOLIDAY01" } };
const EPISODE = { ...SERIES, episode: { type: "integer", minimum: 1, description: "Episode number" } };

export const studioTools: Tool<StudioCtx>[] = [
  {
    name: "watchat_overview",
    title: "Watchat Studio overview",
    description: "Start here. The OpenArt credit budget left this month and every story series with its episodes' Studio stages, including which episodes are waiting for you.",
    readOnly: true,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async (_a, ctx) => {
      const st = await settings(ctx.tenantId);
      const used = await creditsThisMonth(ctx.tenantId);
      const { data: items } = await db()
        .from("studio_items")
        .select("stage, brief, credits_used, episodes!inner(number, title_en), series!inner(code, title_en, story_style)")
        .eq("tenant_id", ctx.tenantId)
        .neq("stage", "published")
        .order("updated_at", { ascending: false })
        .limit(40);
      const { data: storySeries } = await db().from("series").select("code, title_en, story_bible").eq("tenant_id", ctx.tenantId).eq("format", "story");
      const rows = (items ?? []) as unknown as { stage: Stage; brief: string | null; credits_used: number; episodes: { number: number; title_en: string | null }; series: { code: string; title_en: string; story_style: string } }[];
      return {
        budget: { monthly_credits: st.monthly, used_this_month: used, left: Math.max(0, st.monthly - used), episode_cap: st.episodeCap, artwork_cap_per_series: st.artworkCap, approx_usd_left: Math.round(Math.max(0, st.monthly - used) * st.usd * 100) / 100 },
        series_to_set_up: (storySeries ?? [])
          .map((x) => ({ x, b: sanitizeBible(x.story_bible) }))
          .filter(({ b }) => b.brief && setupStatus(b) === "needs_claude")
          .map(({ x, b }) => ({ series: x.code, title: x.title_en, planned_episodes: b.planned, brief: b.brief.slice(0, 400) })),
        waiting_for_you: rows
          .filter((r) => STAGE_INFO[r.stage].who === "claude")
          .map((r) => ({ series: r.series.code, episode: r.episodes.number, stage: r.stage, todo: STAGE_INFO[r.stage].hint, brief: (r.brief ?? "").slice(0, 300) })),
        with_the_team: rows.filter((r) => STAGE_INFO[r.stage].who === "team").map((r) => ({ series: r.series.code, episode: r.episodes.number, stage: r.stage })),
        models: Object.fromEntries(Object.entries(MODEL_RATES).map(([k, v]) => [k, `${v.credits} credits per ${v.kind === "image" ? "image" : "second"}`])),
        audio: Object.fromEntries(AUDIO_KINDS.map((k) => [k, `${st.audio[k]} credits per second (max ${AUDIO_RATES[k].maxSeconds} s)`])),
      };
    },
  },
  {
    name: "watchat_get_series",
    title: "Get series",
    description: "A story series: synopsis, look (style), the bible (style line, dialect, rules, theme music, each character's locked look, reference portrait, locked voice and voice sample), characters, flags earlier choices set, and its episodes with their stages.",
    readOnly: true,
    inputSchema: { type: "object", properties: SERIES, required: ["series"], additionalProperties: false },
    run: async (a, ctx) => {
      const s = await seriesByCode(ctx, a.series);
      const bible = sanitizeBible(s.story_bible);
      const chars = sanitizeCharacters(s.story_characters);
      const st = await settings(ctx.tenantId);
      const { data: eps } = await db().from("episodes").select("id, number, title_en, story_draft, story").eq("series_id", s.id).order("number");
      const { data: items } = await db().from("studio_items").select("episode_id, stage").eq("series_id", s.id);
      const stageOf = new Map((items ?? []).map((i) => [i.episode_id, i.stage]));
      const graphs = (eps ?? []).flatMap((e) => [e.story_draft, e.story]).filter(Boolean).map((g) => sanitizeStory(g));
      const art = s as unknown as Record<string, string | null>;
      const proposals = sanitizeProposals(s.studio_artwork);
      const artUsed = await artworkCreditsUsed(s.id);
      return {
        code: s.code,
        status: s.status,
        title: { ar: s.title_ar, en: s.title_en },
        synopsis: s.synopsis_en,
        tagline: s.tagline_en,
        look: s.story_style,
        setup: SETUP_LABEL[setupStatus(bible)],
        team_brief: bible.brief,
        planned_episodes: bible.planned,
        bible: { style: bible.style, dialect: bible.dialect, rules: bible.rules, theme_music: { desc: bible.theme.desc, file: bible.theme.url }, locked: bible.locked },
        outline: bible.outline,
        characters: chars.map((c) => {
          const b = bible.characters.find((x) => x.id === c.id);
          return { id: c.id, name: c.name, color: c.color, look: b?.look ?? "", portrait: b?.portrait ?? null, voice: b?.voice || null, voice_sample: b?.voiceSample ?? null, may_have_voice_lines: Boolean(b?.voice && b.voiceSample) };
        }),
        flags_set_by_earlier_choices: flagsSetIn(graphs),
        artwork: {
          credits: { used: artUsed, cap: st.artworkCap, left: Math.max(0, st.artworkCap - artUsed) },
          slots: Object.fromEntries(
            STUDIO_ART_SLOTS.map((k) => [
              k,
              { size: `${STUDIO_ART[k].w}×${STUDIO_ART[k].h} (${STUDIO_ART[k].ratio})`, use: STUDIO_ART[k].use, has_picture: Boolean(art[STUDIO_ART[k].field]), waiting_for_team: Boolean(proposals[k]) },
            ]),
          ),
        },
        episodes: (eps ?? []).map((e) => ({ number: e.number, title: e.title_en, stage: stageOf.get(e.id) ?? "not in Studio", scenes: e.story_draft ? sanitizeStory(e.story_draft).scenes.length : 0, live: Boolean(e.story) })),
      };
    },
  },
  {
    name: "watchat_get_episode",
    title: "Get episode",
    description: "One episode: its stage, the team's brief and open review notes (do what they ask), the current script draft with its sound cues, its problems, and the pictures and sounds still missing.",
    readOnly: true,
    inputSchema: { type: "object", properties: EPISODE, required: ["series", "episode"], additionalProperties: false },
    run: async (a, ctx) => {
      const s = await seriesByCode(ctx, a.series);
      const { ep, item } = await episodeOf(s.id, a.episode);
      const st = await settings(ctx.tenantId);
      const draft = ep.story_draft ? sanitizeStory(ep.story_draft) : null;
      return {
        episode: ep.number,
        title: { ar: ep.title_ar, en: ep.title_en },
        stage: item.stage,
        what_to_do: STAGE_INFO[item.stage].hint,
        brief: item.brief,
        open_team_notes: openNotes(item.notes).map((n) => n.text),
        credits: { used: item.credits_used, cap: st.episodeCap },
        script: draft ? compactScript(draft) : null,
        problems: draft ? scriptChecks(draft, sanitizeCharacters(s.story_characters), sanitizeBible(s.story_bible)).map((i) => `${i.level}: ${i.message}`) : [],
        media_missing: draft ? mediaMissing(draft) : { pictures: [], audio: [] },
      };
    },
  },
  {
    name: "watchat_save_series_bible",
    title: "Save series bible",
    description:
      "Set up or update the series bible: the style line used in every picture prompt, the dialect, house rules, theme music (description and OpenArt file address), characters (id, Arabic/English name, colour, locked look, reference portrait file, locked voice description and voice sample file, both from OpenArt) and the episode outline (number, Arabic/English title, a short brief per episode). Refused once the team locks it.",
    inputSchema: {
      type: "object",
      properties: {
        ...SERIES,
        style: { type: "string", description: "One style line pasted into every picture prompt" },
        dialect: { type: "string" },
        rules: { type: "array", items: { type: "string" } },
        theme_desc: { type: "string", description: "The series theme tune: instruments, mood, tempo" },
        theme_url: { type: "string", description: "OpenArt file address of the theme tune (mp3, m4a or wav)" },
        characters: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              name_ar: { type: "string" },
              name_en: { type: "string" },
              color: { type: "string" },
              look: { type: "string" },
              portrait_url: { type: "string" },
              voice: { type: "string", description: "Locked 15–30 word voice: age, tone, accent, pace. Leave out for characters who never speak aloud." },
              voice_sample_url: { type: "string", description: "OpenArt file address of the reference voice clip" },
            },
            required: ["id"],
          },
        },
        outline: {
          type: "array",
          description: "One item per planned episode",
          items: {
            type: "object",
            properties: { number: { type: "integer", minimum: 1 }, title_ar: { type: "string" }, title_en: { type: "string" }, brief: { type: "string" } },
            required: ["number", "brief"],
          },
        },
      },
      required: ["series"],
      additionalProperties: false,
    },
    run: async (a, ctx) => {
      const s = await seriesByCode(ctx, a.series);
      const current = sanitizeBible(s.story_bible);
      const incoming = (Array.isArray(a.characters) ? a.characters : []).map(obj);
      // Reference portraits, voice samples and the theme are copied into Watchat's storage so they outlive OpenArt.
      const chars: NonNullable<BiblePatch["characters"]> = [];
      for (const c of incoming.slice(0, 20)) {
        const id = text(c.id, 40).toLowerCase();
        if (!/^[a-z0-9_-]{1,40}$/.test(id)) continue;
        const portraitUrl = text(c.portrait_url, 1500);
        const sampleUrl = text(c.voice_sample_url, 1500);
        const portrait = portraitUrl && !current.locked ? await copyReference(s.code, `portrait-${id}`, portraitUrl, "image") : null;
        const voiceSample = sampleUrl && !current.locked ? await copyReference(s.code, `voice-${id}`, sampleUrl, "audio") : null;
        chars.push({ id, look: text(c.look, 800), voice: text(c.voice, 300), ...(portrait ? { portrait } : {}), ...(voiceSample ? { voiceSample } : {}) });
      }
      const themeUrl = text(a.theme_url, 1500);
      const theme = { desc: text(a.theme_desc, 400), ...(themeUrl && !current.locked ? { url: await copyReference(s.code, "theme", themeUrl, "audio") } : {}) };
      const { bible, refused } = mergeBible(current, {
        style: text(a.style, 800),
        dialect: text(a.dialect, 60),
        rules: Array.isArray(a.rules) ? a.rules.map((r) => text(r, 200)).filter(Boolean).slice(0, 25) : [],
        characters: chars,
        theme,
        outline: sanitizeBible({ outline: Array.isArray(a.outline) ? a.outline : [] }).outline,
      });
      if (refused.length && !bible.characters.length && !bible.style) throw new ToolError(refused.join(" "));
      let characters: Character[] = sanitizeCharacters(s.story_characters);
      if (!current.locked && incoming.length) {
        const byId = new Map(characters.map((c) => [c.id, c]));
        for (const c of incoming) {
          const id = text(c.id, 40).toLowerCase();
          if (!/^[a-z0-9_-]{1,40}$/.test(id)) continue;
          const prev = byId.get(id);
          byId.set(id, {
            id,
            name: { ar: text(c.name_ar, 40) || prev?.name.ar || "", en: text(c.name_en, 40) || prev?.name.en || "" },
            color: /^#[0-9a-f]{6}$/i.test(text(c.color, 7)) ? text(c.color, 7).toLowerCase() : (prev?.color ?? "#ff6b5e"),
            avatar: prev?.avatar ?? null,
            ...(prev?.owner ? { owner: true } : {}),
          });
        }
        characters = sanitizeCharacters([...byId.values()]);
      }
      await db().from("series").update({ story_bible: bible, story_characters: characters }).eq("id", s.id).eq("tenant_id", ctx.tenantId);
      return {
        saved: !current.locked,
        refused,
        setup: SETUP_LABEL[setupStatus(bible)],
        characters: bible.characters.map((c) => ({ id: c.id, has_portrait: Boolean(c.portrait), voice: c.voice ? (c.voiceSample ? "locked voice + sample" : "voice described, sample missing") : "no voice" })),
        theme_music: bible.theme.url ? "file saved" : bible.theme.desc ? "described, file missing" : "missing",
        outline_episodes: bible.outline.length,
        next:
          setupStatus(bible) === "to_review"
            ? "Make the reference portraits, voice samples and theme tune if not done, then stop: the team reviews and locks the bible."
            : "Add the missing parts (style, characters, outline).",
      };
    },
  },
  {
    name: "watchat_save_episode_script",
    title: "Save episode script",
    description:
      'Save the episode\'s script as its draft (stage brief or writing only). "script" is {"title":{"ar","en"},"story":{"v":1,"start":"s1","scenes":[...]}} with scenes {id, name, image_ref, speaker (character id or null), text{ar,en}, motion, auto, route}. Routes: {"type":"next","to":"s2"} | {"type":"choices","options":[{"id","label":{"ar","en"},"to","price","sets"}]} (2–6 options; each option leads to its own next scene — options that go to the same scene and remember the same thing are refused) | {"type":"branch","flag","ifSet","ifNot"} | {"type":"end","ending":null}. Sound (optional): story.music = [{"id":"mus_01","desc","mood"}] (1–2 beds per episode) and per scene "audio": {"music":"mus_01" (starts that bed) | "stop", "sfx":[{"id":"sfx_03","desc"}] (≤2), "voice":{"id":"vo_s06"} (only when the speaker has a locked voice; the line is the scene text)}. Returns problems to fix; fix all errors before submitting.',
    inputSchema: {
      type: "object",
      properties: { ...EPISODE, script: { type: "object", description: "The episode script (see the description)" } },
      required: ["series", "episode", "script"],
      additionalProperties: false,
    },
    run: async (a, ctx) => {
      const s = await seriesByCode(ctx, a.series);
      const { ep, item } = await episodeOf(s.id, a.episode);
      if (!claudeMay.writeScript(item.stage)) throw new ToolError(`Episode ${ep.number} is at "${STAGE_INFO[item.stage].label}": the script can't change now. ${STAGE_INFO[item.stage].hint}.`);
      const script = typeof a.script === "string" ? (JSON.parse(a.script) as unknown) : a.script;
      const so = obj(script);
      const chars = sanitizeCharacters(s.story_characters);
      const parsed = parseStoryImport(JSON.stringify({ characters: chars, episodes: [{ number: ep.number, title: so.title, story: so.story ?? so }] }));
      // Keep pictures and sounds already made for the same names (a rewrite after review).
      const story = keepMade(parsed.episodes[0].story, ep.story_draft ? sanitizeStory(ep.story_draft) : null);
      const t = obj(so.title);
      await db()
        .from("episodes")
        .update({ story_draft: story, ...(text(t.ar) ? { title_ar: text(t.ar) } : {}), ...(text(t.en) ? { title_en: text(t.en) } : {}) })
        .eq("id", ep.id);
      await setItem(ep.id, { stage: "writing" });
      const problems = scriptChecks(story, chars, sanitizeBible(s.story_bible));
      return {
        saved: true,
        scenes: story.scenes.length,
        errors: problems.filter((p) => p.level === "error").map((p) => p.message),
        warnings: problems.filter((p) => p.level === "warning").map((p) => p.message),
        notes: parsed.notes,
        picture_names: [...new Set(story.scenes.map((x) => x.ref).filter(Boolean))],
        sound_names: audioPlan(story).map((x) => x.ref),
        next: problems.some((p) => p.level === "error") ? "Fix the errors and save again." : "Call watchat_submit_for_review, then stop until the team approves the script.",
      };
    },
  },
  {
    name: "watchat_reserve_credits",
    title: "Reserve OpenArt credits",
    description:
      'Call BEFORE every OpenArt generation. Give the model (e.g. "nano-banana-pro", "nano-banana-2", "kling-3", or the audio model\'s name), kind (image|video|audio), count (1–12), seconds for a video or any audio, audio_kind for audio (music|sfx|voice|lipsync), and the credits OpenArt shows if you know them. Returns ok or a refusal: never generate after a refusal. For an episode it needs stage "pictures" (Media); for portraits, voice samples and the theme tune leave out the episode (series bible not locked yet); for series artwork set "artwork" to the slot (poster, banner_wide, banner_wa, square) and leave out the episode — it counts against the series\' artwork cap.',
    inputSchema: {
      type: "object",
      properties: {
        ...SERIES,
        episode: { type: "integer", minimum: 1, description: "Episode number; leave out for character portraits and artwork" },
        artwork: { type: "string", enum: STUDIO_ART_SLOTS, description: "Series artwork slot this picture is for" },
        model: { type: "string" },
        kind: { type: "string", enum: ["image", "video", "audio"] },
        audio_kind: { type: "string", enum: ["music", "sfx", "voice", "lipsync"], description: "For kind audio" },
        count: { type: "integer", minimum: 1, maximum: 12 },
        seconds: { type: "integer", minimum: 1, maximum: 180, description: "Clip or sound length" },
        credits: { type: "integer", minimum: 0, description: "Total credits OpenArt shows for this generation, if known" },
        purpose: { type: "string", description: "e.g. img_05 retake, portraits" },
      },
      required: ["series", "model", "kind", "count"],
      additionalProperties: false,
    },
    run: async (a, ctx) => {
      const s = await seriesByCode(ctx, a.series);
      const kind = a.kind === "video" ? "video" : a.kind === "audio" ? "audio" : "image";
      const audioKind = AUDIO_KINDS.find((k) => k === a.audio_kind) as AudioKind | undefined;
      const st = await settings(ctx.tenantId);
      const est = estimateCredits({ model: text(a.model, 60), kind, audioKind, count: Number(a.count), seconds: Number(a.seconds) || undefined, credits: Number(a.credits) || undefined }, st.audio);
      if ("error" in est) throw new ToolError(est.error);
      const logKind = kind === "audio" ? `audio:${audioKind}` : kind;
      const used = await creditsThisMonth(ctx.tenantId);
      let episodeId: string | null = null;
      let episodeUsed = 0;
      if (a.artwork !== undefined && a.artwork !== null) {
        const slot = artSlot(a.artwork);
        if (!slot) throw new ToolError(`artwork must be one of ${STUDIO_ART_SLOTS.join(", ")}.`);
        if (a.episode !== undefined && a.episode !== null) throw new ToolError("Artwork belongs to the series: leave out the episode.");
        if (kind !== "image") throw new ToolError("Artwork is a picture: kind must be image.");
        const artUsed = await artworkCreditsUsed(s.id);
        const v = checkBudget({ monthly: st.monthly, monthUsed: used, episodeCap: st.artworkCap, episodeUsed: artUsed }, est.credits, "This series' artwork");
        if (!v.ok) return { ok: false, reason: v.reason, month_left: v.monthLeft, artwork_left: v.episodeLeft };
        await db()
          .from("studio_credit_log")
          .insert({ tenant_id: ctx.tenantId, series_id: s.id, episode_id: null, model: est.model, kind: "artwork", credits: est.credits, note: `${slot}${text(a.purpose, 180) ? `: ${text(a.purpose, 180)}` : ""}` });
        return { ok: true, reserved: est.credits, month_left: v.monthLeft, artwork_left: v.episodeLeft, size: `${STUDIO_ART[slot].w}×${STUDIO_ART[slot].h} (${STUDIO_ART[slot].ratio})` };
      }
      if (a.episode !== undefined && a.episode !== null) {
        const { ep, item } = await episodeOf(s.id, a.episode);
        if (!claudeMay.attachMedia(item.stage)) throw new ToolError(`Episode ${ep.number} is at "${STAGE_INFO[item.stage].label}". Pictures and sound are made only after the team approves the script (stage "pictures", shown as Media).`);
        episodeId = ep.id;
        episodeUsed = item.credits_used;
      } else {
        if (sanitizeBible(s.story_bible).locked) throw new ToolError("The bible is locked; portraits, voice samples and the theme can't be regenerated. Give an episode number for scene pictures and sound.");
        if (kind === "video" || audioKind === "lipsync" || audioKind === "sfx") throw new ToolError("Without an episode only portraits, voice samples and the theme tune can be made.");
        if (est.credits > 600) throw new ToolError("Series setup files are limited to 600 credits per request.");
      }
      const verdict = checkBudget({ monthly: st.monthly, monthUsed: used, episodeCap: episodeId ? st.episodeCap : Number.MAX_SAFE_INTEGER, episodeUsed }, est.credits);
      if (!verdict.ok) return { ok: false, reason: verdict.reason, month_left: verdict.monthLeft, episode_left: episodeId ? verdict.episodeLeft : null };
      await db()
        .from("studio_credit_log")
        .insert({ tenant_id: ctx.tenantId, series_id: s.id, episode_id: episodeId, model: est.model, kind: logKind, credits: est.credits, note: text(a.purpose, 200) || null });
      if (episodeId) await setItem(episodeId, { credits_used: episodeUsed + est.credits });
      return { ok: true, reserved: est.credits, month_left: verdict.monthLeft, episode_left: episodeId ? verdict.episodeLeft : null };
    },
  },
  {
    name: "watchat_attach_media",
    title: "Attach pictures, clips and sound",
    description:
      'Put OpenArt results on the episode (stage "pictures", shown as Media, only): media is {"img_01": "https://…", "mus_01": "https://…", "sfx_03": …, "vo_s06": …}, at most 8 per call, using the names from the script. Each file is copied into Watchat\'s storage: pictures go on every scene with that picture name (MP4s become the scene\'s clip); sounds (mp3, m4a, wav, ≤10 MB) go on that music bed, sound effect or voice line. Use only real addresses OpenArt returned.',
    inputSchema: {
      type: "object",
      properties: { ...EPISODE, media: { type: "object", additionalProperties: { type: "string" }, description: "picture or sound name → OpenArt file address" } },
      required: ["series", "episode", "media"],
      additionalProperties: false,
    },
    run: async (a, ctx) => {
      const s = await seriesByCode(ctx, a.series);
      const { ep, item } = await episodeOf(s.id, a.episode);
      if (!claudeMay.attachMedia(item.stage)) throw new ToolError(`Episode ${ep.number} is at "${STAGE_INFO[item.stage].label}"; pictures and sound can be attached only at stage "pictures" (Media).`);
      const entries = Object.entries(obj(a.media)).filter((e): e is [string, string] => typeof e[1] === "string");
      if (!entries.length) throw new ToolError('Give media as {"img_01": "https://…"}.');
      if (entries.length > 8) throw new ToolError("At most 8 files per call; send the rest in another call.");
      const results: Record<string, string> = {};
      for (const [ref, url] of entries) {
        try {
          const r = await copyStoryMedia({ id: s.id, code: s.code }, ref, url, ep.id);
          results[ref] = r.scenes ? `placed on ${r.scenes} scene(s) as ${r.type}` : "nothing in the script uses this name";
        } catch (e) {
          results[ref] = `failed: ${e instanceof Error ? e.message : "error"}`;
        }
      }
      const { data: after } = await db().from("episodes").select("story_draft").eq("id", ep.id).maybeSingle();
      return { results, media_missing: after?.story_draft ? mediaMissing(sanitizeStory(after.story_draft)) : { pictures: [], audio: [] } };
    },
  },
  {
    name: "watchat_attach_artwork",
    title: "Attach series artwork",
    description:
      'Put a picture OpenArt made on the series page: slot is poster (1000×1500, 2:3), banner_wide (1920×1080, 16:9), banner_wa (1200×628) or square (1080×1080); url is the OpenArt file address (JPG, PNG or WebP). It is copied into Watchat\'s storage. It goes straight onto the series unless the series is live and that slot already has a picture: then it waits for the team ("Use it" in Admin → Studio). Reserve credits with artwork set to the slot before generating.',
    inputSchema: {
      type: "object",
      properties: {
        ...SERIES,
        slot: { type: "string", enum: STUDIO_ART_SLOTS },
        url: { type: "string", description: "OpenArt file address" },
        note: { type: "string", description: "Short note for the team (what it shows)" },
      },
      required: ["series", "slot", "url"],
      additionalProperties: false,
    },
    run: async (a, ctx) => {
      const s = await seriesByCode(ctx, a.series);
      const slot = artSlot(a.slot);
      if (!slot) throw new ToolError(`slot must be one of ${STUDIO_ART_SLOTS.join(", ")}.`);
      const url = text(a.url, 1500);
      if (!url) throw new ToolError("Give the OpenArt file address.");
      const { field } = STUDIO_ART[slot];
      let copied: { url: string; path: string };
      try {
        copied = await copyArtwork(s.code, slot, url);
      } catch (e) {
        throw new ToolError(e instanceof Error ? e.message : "Couldn't copy the picture.");
      }
      const current = (s as unknown as Record<string, string | null>)[field];
      if (artworkPlacement(s.status, current) === "set") {
        await db().from("series").update({ [field]: copied.url }).eq("id", s.id).eq("tenant_id", ctx.tenantId);
        return { placed: "on the series", slot, message: `The ${slot.replace("_", " ")} is on ${s.code}'s series page.` };
      }
      const proposals = { ...sanitizeProposals(s.studio_artwork), [slot]: { url: copied.url, path: copied.path, at: new Date().toISOString(), note: text(a.note, 200) } };
      await db().from("series").update({ studio_artwork: proposals }).eq("id", s.id).eq("tenant_id", ctx.tenantId);
      return { placed: "waiting for the team", slot, message: `${s.code} is live and already has a ${slot.replace("_", " ")}: the team decides in Admin → Studio. Stop here.` };
    },
  },
  {
    name: "watchat_submit_for_review",
    title: "Submit for review",
    description: "Hand the episode to the team: after writing → script review; after media → final check. Refused while the script has errors or any picture or sound is missing. Add a short note about what you did or what the team should look at. Then stop.",
    inputSchema: { type: "object", properties: { ...EPISODE, note: { type: "string" } }, required: ["series", "episode"], additionalProperties: false },
    run: async (a, ctx) => {
      const s = await seriesByCode(ctx, a.series);
      const { ep, item } = await episodeOf(s.id, a.episode);
      const to = claudeMay.submit(item.stage) ? afterSubmit(item.stage) : null;
      if (!to) throw new ToolError(`Episode ${ep.number} is already with the team ("${STAGE_INFO[item.stage].label}").`);
      const draft = ep.story_draft ? sanitizeStory(ep.story_draft) : null;
      if (!draft || !draft.scenes.length) throw new ToolError("Save the script first (watchat_save_episode_script).");
      const errors = scriptChecks(draft, sanitizeCharacters(s.story_characters), sanitizeBible(s.story_bible)).filter((p) => p.level === "error");
      if (errors.length) throw new ToolError(`Fix these first: ${errors.map((e) => e.message).join(" ")}`);
      if (to === "final_check") {
        const missing = mediaMissing(draft);
        const parts = [missing.pictures.length ? `pictures ${missing.pictures.join(", ")}` : "", missing.audio.length ? `sounds ${missing.audio.join(", ")}` : ""].filter(Boolean);
        if (parts.length) throw new ToolError(`Still missing: ${parts.join("; ")}. Attach them first.`);
      }
      const notes = addNote(closeNotes(item.notes), { by: "Claude", who: "claude", text: text(a.note, 1000) || `Submitted for ${STAGE_INFO[to].label.toLowerCase()}.`, stage: to });
      await setItem(ep.id, { stage: to, notes });
      return { stage: to, message: `Episode ${ep.number} is with the team for ${STAGE_INFO[to].label.toLowerCase()}. Stop here.` };
    },
  },
];
