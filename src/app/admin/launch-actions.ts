"use server";

// "Launch a series" wizard: 1 details → 2 artwork → 3 episodes → 4 free episodes & price → 5 licence, check, publish.
// Steps 2 and 3 upload straight from the browser (same components as the series page); these actions save the rest.

import { audit, requireAdmin } from "@/lib/admin/auth";
import { done, int, opt, str, uuid } from "@/lib/admin/forms";
import { readiness } from "@/lib/admin/readiness";
import { suggestCode } from "@/lib/admin/readiness";
import { GENRES } from "@/lib/content-meta";
import { db } from "@/lib/supabase";
import { originalLang } from "@/lib/storage/tracks";
import { STORY_STYLES } from "@/lib/story/types";

const CODE_RE = /^[A-Z]{3,}\d{1,3}$/;
const launch = (id: string, step: number) => `/admin/series/${id}/launch?step=${step}`;

async function own(tenantId: string, id: string | null) {
  if (!id) return null;
  const { data } = await db().from("series").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  return data;
}

export async function createLaunchSeriesAction(fd: FormData) {
  const admin = await requireAdmin("content");
  const titleAr = str(fd, "title_ar", 120);
  const titleEn = str(fd, "title_en", 120);
  if (!titleAr || !titleEn) done("/admin/series/new", "Add the Arabic and English titles.", "err");
  const episodes = Math.min(Math.max(int(fd, "episodes", 30), 1), 200);

  let code = str(fd, "code", 20).toUpperCase();
  if (code && !CODE_RE.test(code)) done("/admin/series/new", "The code is letters then 1–3 digits, e.g. DESERT01 (or leave it empty).", "err");
  if (!code) {
    const { data: taken } = await db().from("series").select("code").eq("tenant_id", admin.tenantId);
    code = suggestCode(titleEn, (taken ?? []).map((t) => t.code as string));
  }

  const kind = str(fd, "kind", 20);
  const storyStyle = STORY_STYLES.find((x) => x.key === kind)?.key ?? null;
  const genres = [...new Set(fd.getAll("genres").map(String))].filter((g) => (GENRES as readonly string[]).includes(g));
  const { data: series, error } = await db()
    .from("series")
    .insert({
      tenant_id: admin.tenantId,
      code,
      title_ar: titleAr,
      title_en: titleEn,
      synopsis_ar: opt(fd, "synopsis_ar", 1000),
      synopsis_en: opt(fd, "synopsis_en", 1000),
      tagline_ar: opt(fd, "tagline_ar", 140),
      tagline_en: opt(fd, "tagline_en", 140),
      dialect: originalLang(str(fd, "dialect", 30)),
      genres,
      status: "draft",
      // Story series are built scene by scene and play on the web only (the chat sends the link, no chat episodes).
      ...(storyStyle ? { format: "story", story_style: storyStyle, wa_episode_count: 0 } : {}),
    })
    .select("id")
    .single();
  if (error || !series) done("/admin/series/new", error?.code === "23505" ? `The code ${code} is already used: pick another.` : "Couldn't create the series.", "err");

  await db()
    .from("episodes")
    .insert(Array.from({ length: episodes }, (_, i) => ({ series_id: series.id, number: i + 1, title_ar: `الحلقة ${i + 1}`, title_en: `Episode ${i + 1}`, status: "draft" })));
  await audit(admin, "series.created", "series", series.id, { code, episodes, via: "launch" });
  done(launch(series.id, 2), `${code} created with ${episodes} episodes. Viewers send ${code} to start it in the chat.`);
}

export async function saveLaunchPriceAction(fd: FormData) {
  const admin = await requireAdmin("content");
  const id = uuid(fd, "id");
  const s = await own(admin.tenantId, id);
  if (!s || !id) done("/admin/series", "Series not found.", "err");
  const free = Math.max(0, int(fd, "free_eps", 5));
  const chat = s.format === "story" ? 0 : Math.min(5, Math.max(0, int(fd, "chat_eps", 3)));
  const coins = int(fd, "coins_per_episode", 10);
  if (coins < 1 || coins > 1000) done(launch(id, 4), "Ping per episode must be 1–1000.", "err");
  if (chat > free) done(launch(id, 4), "Episodes sent in the chat must be free too: raise the free episodes or lower the chat ones.", "err");
  await db()
    .from("series")
    .update({ free_web_until_ep: free, paywall_ep: free + 1, wa_episode_count: chat, coins_per_episode: coins })
    .eq("id", id)
    .eq("tenant_id", admin.tenantId);
  await audit(admin, "series.updated", "series", id, { free, chat, coins, via: "launch" });
  done(launch(id, 5), "Saved.");
}

export async function finishLaunchAction(fd: FormData) {
  const admin = await requireAdmin("content");
  const id = uuid(fd, "id");
  const s = await own(admin.tenantId, id);
  if (!s || !id) done("/admin/series", "Series not found.", "err");
  const back = launch(id, 5);

  // Licence (only when filled in; one is enough to publish).
  const licensor = str(fd, "licensor", 200);
  if (licensor) {
    const territory = str(fd, "territory", 200) || "MENA";
    const startsOn = str(fd, "starts_on", 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn)) done(back, "Add the licence start date.", "err");
    await db().from("licences").insert({ series_id: id, licensor, territory, starts_on: startsOn, ends_on: opt(fd, "ends_on", 10) });
    await audit(admin, "licence.added", "series", id, { licensor, territory, via: "launch" });
  }

  // Where it's shown (empty = every market).
  const { data: markets } = await db().from("markets").select("country").eq("tenant_id", admin.tenantId);
  const allowed = new Set((markets ?? []).map((m) => m.country as string));
  const countries = [...new Set(fd.getAll("license").map((c) => String(c).toUpperCase()))].filter((c) => allowed.has(c));
  await db().from("series").update({ license_countries: countries }).eq("id", id).eq("tenant_id", admin.tenantId);

  // Content check: ticking the box records an approved review.
  if (fd.get("family_safe") === "on") {
    await db().from("content_reviews").insert({ series_id: id, reviewer: admin.email, decision: "approved", notes: "Checked in the launch wizard" });
    await audit(admin, "series.review.approved", "series", id, { via: "launch" });
  }

  if (str(fd, "publish", 10) !== "live") done(`/admin/series/${id}`, "Saved as a draft. Publish from the checklist when you're ready.");

  const [{ data: episodes }, { count: licences }, { data: review }] = await Promise.all([
    db().from("episodes").select("number, status, stream_uid, wa_video_url_ar, story_ready").eq("series_id", id),
    db().from("licences").select("id", { count: "exact", head: true }).eq("series_id", id),
    db().from("content_reviews").select("decision").eq("series_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const r = readiness(s, episodes ?? [], licences ?? 0, review?.decision ?? null);
  if (!r.ready) {
    const missing = r.items.filter((i) => i.required && !i.done).map((i) => `${i.label} (${i.detail})`);
    done(back, `Not published yet. Still needed: ${missing.join(" · ")}.`, "err");
  }

  // Episodes with a video go live with the series; the rest stay hidden until their video is uploaded.
  await db().from("episodes").update({ status: "live" }).eq("series_id", id).in("status", ["draft", "in_review"]).or("stream_uid.not.is.null,story_ready.eq.true");
  await db().from("series").update({ status: "live" }).eq("id", id).eq("tenant_id", admin.tenantId);
  await audit(admin, "series.status.live", "series", id, { via: "launch" });
  done(`/admin/series/${id}`, `🎉 ${s.code} is live. Viewers can send ${s.code} in WhatsApp or Telegram to start.`);
}
