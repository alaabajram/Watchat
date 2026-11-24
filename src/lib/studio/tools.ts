// The Watchat connector's tools (Claude → Watchat Studio). Server only. Claude can read story series, keep the
// series bible, write episode scripts into drafts, reserve OpenArt credits before generating, attach the files
// and submit for review. It can never publish, and only works on episodes the team opened a brief for.

import { hostAllowed } from "@/lib/story/import";
import { copyStoryMedia, importHosts } from "@/lib/story/media-server";
import { parseStoryImport } from "@/lib/story/import";
import { flagsSetIn } from "@/lib/story/engine";
import { sanitizeCharacters, sanitizeStory } from "@/lib/story/sanitize";
import type { Character, StoryGraph } from "@/lib/story/types";
import { validateStory } from "@/lib/story/validate";
import { copyToCloudflare } from "@/lib/storage/cloudflare";
import { randomToken } from "@/lib/crypto";
import { db } from "@/lib/supabase";
import { mergeBible, sanitizeBible, type BibleCharacter } from "./bible";
import { checkBudget, estimateCredits, MODEL_RATES, monthStart } from "./budget";
import { ToolError, type Tool } from "./mcp";
import { addNote, afterSubmit, claudeMay, closeNotes, openNotes, sanitizeNotes, STAGE_INFO, isStage, type Stage } from "./stages";

export type StudioCtx = { tenantId: string; adminId: string; adminName: string };

export const STUDIO_INSTRUCTIONS = `Watchat Studio (the Watchat micro-drama platform, not any other studio): you write and illustrate episodes of Arabic-first interactive story series for the Watchat team.
Rules (cost-aware; follow them exactly):
1. Start with watchat_overview. Work on ONE episode per conversation, and only on episodes listed as waiting for you (stage brief, writing or pictures).
2. Read watchat_get_series (bible, characters, earlier flags) and watchat_get_episode (brief, team notes) before writing. Follow the bible's style line, dialect and rules, and every open team note.
3. Writing stage: save the script with watchat_save_episode_script, fix every error it reports, then watchat_submit_for_review and STOP. Do not make any pictures before the team approves the script (stage "pictures").
4. Pictures stage: BEFORE every OpenArt generation call watchat_reserve_credits with the model, kind and count. If it refuses, stop and tell the user; never generate without an "ok". Prefer Nano Banana Pro for pictures; make at most one retake per picture; reuse pictures across scenes (≤12 unique per episode); make clips only if the brief asks for them. Attach results with watchat_attach_media (file addresses), then watchat_submit_for_review.
5. Keep your messages to the user short. Never invent file addresses.`;

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const text = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

async function seriesByCode(ctx: StudioCtx, code: unknown) {
  const c = text(code, 30).toUpperCase();
  if (!/^[A-Z0-9_-]{2,30}$/.test(c)) throw new ToolError("Give the series code, e.g. HOLIDAY01 (watchat_overview lists them).");
  const { data } = await db()
    .from("series")
    .select("id, code, title_ar, title_en, synopsis_en, tagline_en, format, story_style, story_characters, story_bible")
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
  const { data } = await db().from("studio_settings").select("monthly_credits, episode_credits, usd_per_credit").eq("tenant_id", tenantId).maybeSingle();
  return { monthly: data?.monthly_credits ?? 24000, episodeCap: data?.episode_credits ?? 2500, usd: Number(data?.usd_per_credit ?? 0.0015) };
}

export async function creditsThisMonth(tenantId: string): Promise<number> {
  const { data } = await db().from("studio_credit_log").select("credits").eq("tenant_id", tenantId).gte("created_at", monthStart());
  return (data ?? []).reduce((a, r) => a + (r.credits ?? 0), 0);
}

const missingPictures = (g: StoryGraph) => [...new Set(g.scenes.filter((s) => !s.image && !s.video).map((s) => s.ref ?? s.id))];

/** A compact script for Claude to read (no media addresses, just whether a scene has its picture). */
function compactScript(g: StoryGraph) {
  return {
    start: g.start,
    scenes: g.scenes.map((s) => ({ id: s.id, name: s.name, image_ref: s.ref ?? null, has_picture: Boolean(s.image || s.video), speaker: s.speaker, text: s.text, motion: s.motion, auto: s.auto, route: s.route })),
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
      const rows = (items ?? []) as unknown as { stage: Stage; brief: string | null; credits_used: number; episodes: { number: number; title_en: string | null }; series: { code: string; title_en: string; story_style: string } }[];
      return {
        budget: { monthly_credits: st.monthly, used_this_month: used, left: Math.max(0, st.monthly - used), episode_cap: st.episodeCap, approx_usd_left: Math.round(Math.max(0, st.monthly - used) * st.usd * 100) / 100 },
        waiting_for_you: rows
          .filter((r) => STAGE_INFO[r.stage].who === "claude")
          .map((r) => ({ series: r.series.code, episode: r.episodes.number, stage: r.stage, todo: STAGE_INFO[r.stage].hint, brief: (r.brief ?? "").slice(0, 300) })),
        with_the_team: rows.filter((r) => STAGE_INFO[r.stage].who === "team").map((r) => ({ series: r.series.code, episode: r.episodes.number, stage: r.stage })),
        models: Object.fromEntries(Object.entries(MODEL_RATES).map(([k, v]) => [k, `${v.credits} credits per ${v.kind === "image" ? "image" : "second"}`])),
      };
    },
  },
  {
    name: "watchat_get_series",
    title: "Get series",
    description: "A story series: synopsis, look (style), the bible (style line, dialect, rules, each character's locked look and reference portrait), characters, flags earlier choices set, and its episodes with their stages.",
    readOnly: true,
    inputSchema: { type: "object", properties: SERIES, required: ["series"], additionalProperties: false },
    run: async (a, ctx) => {
      const s = await seriesByCode(ctx, a.series);
      const bible = sanitizeBible(s.story_bible);
      const chars = sanitizeCharacters(s.story_characters);
      const { data: eps } = await db().from("episodes").select("id, number, title_en, story_draft, story").eq("series_id", s.id).order("number");
      const { data: items } = await db().from("studio_items").select("episode_id, stage").eq("series_id", s.id);
      const stageOf = new Map((items ?? []).map((i) => [i.episode_id, i.stage]));
      const graphs = (eps ?? []).flatMap((e) => [e.story_draft, e.story]).filter(Boolean).map((g) => sanitizeStory(g));
      return {
        code: s.code,
        title: { ar: s.title_ar, en: s.title_en },
        synopsis: s.synopsis_en,
        tagline: s.tagline_en,
        look: s.story_style,
        bible: { style: bible.style, dialect: bible.dialect, rules: bible.rules, locked: bible.locked },
        characters: chars.map((c) => {
          const b = bible.characters.find((x) => x.id === c.id);
          return { id: c.id, name: c.name, color: c.color, look: b?.look ?? "", portrait: b?.portrait ?? null };
        }),
        flags_set_by_earlier_choices: flagsSetIn(graphs),
        episodes: (eps ?? []).map((e) => ({ number: e.number, title: e.title_en, stage: stageOf.get(e.id) ?? "not in Studio", scenes: e.story_draft ? sanitizeStory(e.story_draft).scenes.length : 0, live: Boolean(e.story) })),
      };
    },
  },
  {
    name: "watchat_get_episode",
    title: "Get episode",
    description: "One episode: its stage, the team's brief and open review notes (do what they ask), the current script draft, its problems, and the picture names still missing.",
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
        problems: draft ? validateStory(draft, { characters: sanitizeCharacters(s.story_characters) }).map((i) => `${i.level}: ${i.message}`) : [],
        pictures_missing: draft ? missingPictures(draft) : [],
      };
    },
  },
  {
    name: "watchat_save_series_bible",
    title: "Save series bible",
    description:
      "Set up or update the series bible: the style line used in every picture prompt, the dialect, house rules, and characters (id, Arabic/English name, colour, locked look, reference portrait file address from OpenArt). Refused once the team locks it.",
    inputSchema: {
      type: "object",
      properties: {
        ...SERIES,
        style: { type: "string", description: "One style line pasted into every picture prompt" },
        dialect: { type: "string" },
        rules: { type: "array", items: { type: "string" } },
        characters: {
          type: "array",
          items: {
            type: "object",
            properties: { id: { type: "string" }, name_ar: { type: "string" }, name_en: { type: "string" }, color: { type: "string" }, look: { type: "string" }, portrait_url: { type: "string" } },
            required: ["id"],
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
      // Reference portraits are copied into Watchat's storage so they outlive OpenArt.
      const chars: BibleCharacter[] = [];
      for (const c of incoming.slice(0, 20)) {
        const id = text(c.id, 40).toLowerCase();
        if (!/^[a-z0-9_-]{1,40}$/.test(id)) continue;
        let portrait: string | null = null;
        const url = text(c.portrait_url, 1500);
        if (url && !current.locked) {
          if (!hostAllowed(url, importHosts())) throw new ToolError(`${id}: portrait files must come from OpenArt.`);
          const copied = await copyToCloudflare(url, `${s.code}/story/portrait-${id}-${randomToken(4)}.jpg`);
          portrait = copied?.publicUrl ?? null;
        }
        chars.push({ id, look: text(c.look, 800), portrait });
      }
      const { bible, refused } = mergeBible(current, {
        style: text(a.style, 800),
        dialect: text(a.dialect, 60),
        rules: Array.isArray(a.rules) ? a.rules.map((r) => text(r, 200)).filter(Boolean).slice(0, 25) : [],
        characters: chars,
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
      return { saved: !current.locked, refused, characters: bible.characters.map((c) => ({ id: c.id, has_portrait: Boolean(c.portrait) })) };
    },
  },
  {
    name: "watchat_save_episode_script",
    title: "Save episode script",
    description:
      'Save the episode\'s script as its draft (stage brief or writing only). "script" is {"title":{"ar","en"},"story":{"v":1,"start":"s1","scenes":[...]}} with scenes {id, name, image_ref, speaker (character id or null), text{ar,en}, motion, auto, route}. Routes: {"type":"next","to":"s2"} | {"type":"choices","options":[{"id","label":{"ar","en"},"to","price","sets"}]} | {"type":"branch","flag","ifSet","ifNot"} | {"type":"end","ending":null}. Returns problems to fix; fix all errors before submitting.',
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
      let story = parsed.episodes[0].story;
      // Keep pictures already placed on scenes whose picture name stays the same (a rewrite after review).
      const old = ep.story_draft ? sanitizeStory(ep.story_draft) : null;
      if (old) {
        const byRef = new Map(old.scenes.filter((x) => x.ref && (x.image || x.video)).map((x) => [x.ref!, x]));
        story = { ...story, scenes: story.scenes.map((x) => (x.ref && byRef.has(x.ref) ? { ...x, image: byRef.get(x.ref)!.image, video: byRef.get(x.ref)!.video } : x)) };
      }
      const t = obj(so.title);
      await db()
        .from("episodes")
        .update({ story_draft: story, ...(text(t.ar) ? { title_ar: text(t.ar) } : {}), ...(text(t.en) ? { title_en: text(t.en) } : {}) })
        .eq("id", ep.id);
      await setItem(ep.id, { stage: "writing" });
      const problems = validateStory(story, { characters: chars });
      return {
        saved: true,
        scenes: story.scenes.length,
        errors: problems.filter((p) => p.level === "error").map((p) => p.message),
        warnings: problems.filter((p) => p.level === "warning").map((p) => p.message),
        notes: parsed.notes,
        picture_names: [...new Set(story.scenes.map((x) => x.ref).filter(Boolean))],
        next: problems.some((p) => p.level === "error") ? "Fix the errors and save again." : "Call watchat_submit_for_review, then stop until the team approves the script.",
      };
    },
  },
  {
    name: "watchat_reserve_credits",
    title: "Reserve OpenArt credits",
    description:
      'Call BEFORE every OpenArt generation. Give the model (e.g. "nano-banana-pro", "nano-banana-2", "kling-3"), kind (image|video), count (1–12), seconds for a video, and the credits OpenArt shows if you know them. Returns ok or a refusal: never generate after a refusal. For an episode it needs stage "pictures"; for character portraits leave out the episode (series bible not locked yet).',
    inputSchema: {
      type: "object",
      properties: {
        ...SERIES,
        episode: { type: "integer", minimum: 1, description: "Episode number; leave out for character portraits" },
        model: { type: "string" },
        kind: { type: "string", enum: ["image", "video"] },
        count: { type: "integer", minimum: 1, maximum: 12 },
        seconds: { type: "integer", minimum: 1, maximum: 15 },
        credits: { type: "integer", minimum: 0, description: "Total credits OpenArt shows for this generation, if known" },
        purpose: { type: "string", description: "e.g. img_05 retake, portraits" },
      },
      required: ["series", "model", "kind", "count"],
      additionalProperties: false,
    },
    run: async (a, ctx) => {
      const s = await seriesByCode(ctx, a.series);
      const est = estimateCredits({ model: text(a.model, 60), kind: a.kind === "video" ? "video" : "image", count: Number(a.count), seconds: Number(a.seconds) || undefined, credits: Number(a.credits) || undefined });
      if ("error" in est) throw new ToolError(est.error);
      const st = await settings(ctx.tenantId);
      const used = await creditsThisMonth(ctx.tenantId);
      let episodeId: string | null = null;
      let episodeUsed = 0;
      if (a.episode !== undefined && a.episode !== null) {
        const { ep, item } = await episodeOf(s.id, a.episode);
        if (!claudeMay.attachMedia(item.stage)) throw new ToolError(`Episode ${ep.number} is at "${STAGE_INFO[item.stage].label}". Pictures are made only after the team approves the script (stage "pictures").`);
        episodeId = ep.id;
        episodeUsed = item.credits_used;
      } else {
        if (sanitizeBible(s.story_bible).locked) throw new ToolError("The characters are locked; portraits can't be regenerated. Give an episode number for scene pictures.");
        if (est.credits > 600) throw new ToolError("Portraits are limited to 600 credits per request.");
      }
      const verdict = checkBudget({ monthly: st.monthly, monthUsed: used, episodeCap: episodeId ? st.episodeCap : Number.MAX_SAFE_INTEGER, episodeUsed }, est.credits);
      if (!verdict.ok) return { ok: false, reason: verdict.reason, month_left: verdict.monthLeft, episode_left: episodeId ? verdict.episodeLeft : null };
      await db()
        .from("studio_credit_log")
        .insert({ tenant_id: ctx.tenantId, series_id: s.id, episode_id: episodeId, model: est.model, kind: a.kind === "video" ? "video" : "image", credits: est.credits, note: text(a.purpose, 200) || null });
      if (episodeId) await setItem(episodeId, { credits_used: episodeUsed + est.credits });
      return { ok: true, reserved: est.credits, month_left: verdict.monthLeft, episode_left: episodeId ? verdict.episodeLeft : null };
    },
  },
  {
    name: "watchat_attach_media",
    title: "Attach pictures and clips",
    description:
      'Put OpenArt results on the episode\'s scenes (stage "pictures" only): media is {"img_01": "https://…", …}, at most 8 per call, using the picture names from the script. Each file is copied into Watchat\'s storage and placed on every scene with that picture name (MP4s become the scene\'s clip). Use only real addresses OpenArt returned.',
    inputSchema: {
      type: "object",
      properties: { ...EPISODE, media: { type: "object", additionalProperties: { type: "string" }, description: "picture name → OpenArt file address" } },
      required: ["series", "episode", "media"],
      additionalProperties: false,
    },
    run: async (a, ctx) => {
      const s = await seriesByCode(ctx, a.series);
      const { ep, item } = await episodeOf(s.id, a.episode);
      if (!claudeMay.attachMedia(item.stage)) throw new ToolError(`Episode ${ep.number} is at "${STAGE_INFO[item.stage].label}"; pictures can be attached only at stage "pictures".`);
      const entries = Object.entries(obj(a.media)).filter((e): e is [string, string] => typeof e[1] === "string");
      if (!entries.length) throw new ToolError('Give media as {"img_01": "https://…"}.');
      if (entries.length > 8) throw new ToolError("At most 8 files per call; send the rest in another call.");
      const results: Record<string, string> = {};
      for (const [ref, url] of entries) {
        try {
          const r = await copyStoryMedia({ id: s.id, code: s.code }, ref, url, ep.id);
          results[ref] = r.scenes ? `placed on ${r.scenes} scene(s) as ${r.type}` : "no scene uses this picture name";
        } catch (e) {
          results[ref] = `failed: ${e instanceof Error ? e.message : "error"}`;
        }
      }
      const { data: after } = await db().from("episodes").select("story_draft").eq("id", ep.id).maybeSingle();
      return { results, pictures_missing: after?.story_draft ? missingPictures(sanitizeStory(after.story_draft)) : [] };
    },
  },
  {
    name: "watchat_submit_for_review",
    title: "Submit for review",
    description: "Hand the episode to the team: after writing → script review; after pictures → final check. Refused while the script has errors or pictures are missing. Add a short note about what you did or what the team should look at. Then stop.",
    inputSchema: { type: "object", properties: { ...EPISODE, note: { type: "string" } }, required: ["series", "episode"], additionalProperties: false },
    run: async (a, ctx) => {
      const s = await seriesByCode(ctx, a.series);
      const { ep, item } = await episodeOf(s.id, a.episode);
      const to = claudeMay.submit(item.stage) ? afterSubmit(item.stage) : null;
      if (!to) throw new ToolError(`Episode ${ep.number} is already with the team ("${STAGE_INFO[item.stage].label}").`);
      const draft = ep.story_draft ? sanitizeStory(ep.story_draft) : null;
      if (!draft || !draft.scenes.length) throw new ToolError("Save the script first (watchat_save_episode_script).");
      const errors = validateStory(draft, { characters: sanitizeCharacters(s.story_characters) }).filter((p) => p.level === "error");
      if (errors.length) throw new ToolError(`Fix these first: ${errors.map((e) => e.message).join(" ")}`);
      if (to === "final_check") {
        const missing = missingPictures(draft);
        if (missing.length) throw new ToolError(`Pictures still missing: ${missing.join(", ")}. Attach them first.`);
      }
      const notes = addNote(closeNotes(item.notes), { by: "Claude", who: "claude", text: text(a.note, 1000) || `Submitted for ${STAGE_INFO[to].label.toLowerCase()}.`, stage: to });
      await setItem(ep.id, { stage: to, notes });
      return { stage: to, message: `Episode ${ep.number} is with the team for ${STAGE_INFO[to].label.toLowerCase()}. Stop here.` };
    },
  },
];
