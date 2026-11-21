"use server";

import { revalidatePath } from "next/cache";
import { audit, requireAdmin } from "@/lib/admin/auth";
import { done, int, num, opt, str, uuid } from "@/lib/admin/forms";
import { AGE_RATINGS, GENRES } from "@/lib/content-meta";
import { readiness } from "@/lib/admin/readiness";
import { randomToken } from "@/lib/crypto";
import { db } from "@/lib/supabase";
import { uploadTarget } from "@/lib/storage/cloudflare";

const CODE_RE = /^[A-Z]{3,}\d{1,3}$/;

/** The series must belong to this admin's label (one platform, many labels). */
async function ownSeries(tenantId: string, seriesId: string | null): Promise<boolean> {
  if (!seriesId) return false;
  const { data } = await db().from("series").select("id").eq("id", seriesId).eq("tenant_id", tenantId).maybeSingle();
  return Boolean(data);
}


const list = (fd: FormData, key: string, max = 20) =>
  [...new Set(fd.getAll(key).flatMap((v) => String(v).split(",")).map((v) => v.trim().toLowerCase().slice(0, 40)).filter(Boolean))].slice(0, max);

/** "2026-11-25T20:00" typed in Gulf time → ISO, or null. */
function gulfTime(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const d = new Date(`${value}:00+04:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function createSeriesAction(fd: FormData) {
  const admin = await requireAdmin("content");
  const code = str(fd, "code", 20).toUpperCase();
  if (!CODE_RE.test(code)) done("/admin/series", "Code must be 3+ letters then 1–3 digits, e.g. SECRETS01.", "err");
  const titleAr = str(fd, "title_ar", 120);
  const titleEn = str(fd, "title_en", 120);
  if (!titleAr || !titleEn) done("/admin/series", "Arabic and English titles are required.", "err");
  const episodes = Math.min(Math.max(int(fd, "episodes", 30), 1), 100);

  const { data: series, error } = await db()
    .from("series")
    .insert({ tenant_id: admin.tenantId, code, title_ar: titleAr, title_en: titleEn, status: "draft" })
    .select("id")
    .single();
  if (error || !series) done("/admin/series", error?.code === "23505" ? "That code is already used." : "Could not create the series.", "err");

  await db()
    .from("episodes")
    .insert(
      Array.from({ length: episodes }, (_, i) => ({
        series_id: series.id,
        number: i + 1,
        title_ar: `الحلقة ${i + 1}`,
        title_en: `Episode ${i + 1}`,
        status: "draft",
      })),
    );
  await audit(admin, "series.created", "series", series.id, { code, episodes });
  done(`/admin/series/${series.id}`, `Series ${code} created with ${episodes} draft episodes.`);
}

export async function updateSeriesAction(fd: FormData) {
  const admin = await requireAdmin("content");
  const id = uuid(fd, "id");
  if (!id) done("/admin/series", "Missing series.", "err");
  const back = `/admin/series/${id}`;

  const waEpisodes = int(fd, "wa_episode_count", 3);
  const freeUntil = int(fd, "free_web_until_ep", 9);
  const paywall = int(fd, "paywall_ep", 10);
  const coins = int(fd, "coins_per_episode", 30);
  if (waEpisodes < 0 || waEpisodes > 5) done(back, "Chat episodes must be 0–5.", "err");
  if (paywall !== freeUntil + 1) done(back, "Paywall episode must be the one right after the last free episode.", "err");
  if (freeUntil < waEpisodes) done(back, "Free web episodes must include the chat episodes.", "err");
  if (coins < 1 || coins > 1000) done(back, "Coins per episode must be 1–1000.", "err");

  const patch = {
    title_ar: str(fd, "title_ar", 120),
    title_en: str(fd, "title_en", 120),
    synopsis_ar: opt(fd, "synopsis_ar", 1000),
    synopsis_en: opt(fd, "synopsis_en", 1000),
    dialect: str(fd, "dialect", 30) || "gulf",
    wa_episode_count: waEpisodes,
    free_web_until_ep: freeUntil,
    paywall_ep: paywall,
    coins_per_episode: coins,
    tagline_ar: opt(fd, "tagline_ar", 140),
    tagline_en: opt(fd, "tagline_en", 140),
    genres: list(fd, "genres").filter((g) => (GENRES as readonly string[]).includes(g)),
    tags: list(fd, "tags", 30),
    age_rating: (AGE_RATINGS as readonly string[]).includes(str(fd, "age_rating", 10)) ? str(fd, "age_rating", 10) : null,
    cast_members: Array.from({ length: 12 }, (_, i) => ({
      name_ar: str(fd, `cast_${i}_ar`, 80),
      name_en: str(fd, `cast_${i}_en`, 80),
      role: str(fd, `cast_${i}_role`, 80),
    })).filter((c) => c.name_ar || c.name_en),
  };
  const { error } = await db().from("series").update(patch).eq("id", id).eq("tenant_id", admin.tenantId);
  if (error) done(back, `Save failed: ${error.message}`, "err");
  await audit(admin, "series.updated", "series", id, patch);
  revalidatePath(back);
  done(back, "Saved.");
}

export async function setSeriesStatusAction(fd: FormData) {
  const admin = await requireAdmin("content");
  const id = uuid(fd, "id");
  const status = str(fd, "status", 20);
  if (!id || !["draft", "in_review", "live", "archived"].includes(status)) done("/admin/series", "Bad request.", "err");
  const back = `/admin/series/${id}`;

  if (status === "live") {
    // Publish gate: a licence on record and an approved family-safe review.
    const [{ count: licences }, { data: review }] = await Promise.all([
      db().from("licences").select("id", { count: "exact", head: true }).eq("series_id", id),
      db().from("content_reviews").select("decision").eq("series_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (!licences) done(back, "Add the licence before publishing.", "err");
    if (review?.decision !== "approved") done(back, "The series needs an approved content review before publishing.", "err");
    // Same checklist as the series page and the launch wizard.
    const [{ data: s }, { data: eps }] = await Promise.all([
      db().from("series").select("*").eq("id", id).eq("tenant_id", admin.tenantId).maybeSingle(),
      db().from("episodes").select("number, status, stream_uid, wa_video_url_ar").eq("series_id", id),
    ]);
    if (!s) done("/admin/series", "Series not found.", "err");
    const r = readiness(s, eps ?? [], licences ?? 0, review?.decision ?? null);
    if (!r.ready) done(back, `Not published yet. Still needed: ${r.items.filter((i) => i.required && !i.done).map((i) => `${i.label} (${i.detail})`).join(" · ")}.`, "err");
  }

  await db().from("series").update({ status }).eq("id", id).eq("tenant_id", admin.tenantId);
  // Ready episodes with a video go live with the series; one without a video stays hidden until it has one.
  if (status === "live") await db().from("episodes").update({ status: "live" }).eq("series_id", id).eq("status", "in_review").not("stream_uid", "is", null);
  await audit(admin, `series.status.${status}`, "series", id);
  done(back, `Status set to ${status}.`);
}

export async function reviewSeriesAction(fd: FormData) {
  const admin = await requireAdmin("content");
  const id = uuid(fd, "id");
  const decision = str(fd, "decision", 20);
  if (!id || (decision !== "approved" && decision !== "rejected")) done("/admin/series", "Bad request.", "err");
  await db().from("content_reviews").insert({ series_id: id, reviewer: admin.email, decision, notes: opt(fd, "notes", 1000) });
  if (decision === "approved") await db().from("episodes").update({ status: "in_review" }).eq("series_id", id).eq("status", "draft");
  await audit(admin, `series.review.${decision}`, "series", id);
  done(`/admin/series/${id}`, decision === "approved" ? "Review approved. You can publish now." : "Review rejected.");
}

export async function addLicenceAction(fd: FormData) {
  const admin = await requireAdmin("content");
  const id = uuid(fd, "series_id");
  if (!id) done("/admin/series", "Missing series.", "err");
  const licensor = str(fd, "licensor", 200);
  const territory = str(fd, "territory", 200);
  const startsOn = str(fd, "starts_on", 10);
  if (!licensor || !territory || !/^\d{4}-\d{2}-\d{2}$/.test(startsOn)) done(`/admin/series/${id}`, "Licensor, territory and start date are required.", "err");
  await db()
    .from("licences")
    .insert({
      series_id: id,
      licensor,
      territory,
      starts_on: startsOn,
      ends_on: opt(fd, "ends_on", 10),
      document_url: opt(fd, "document_url", 500),
      revenue_share_pct: num(fd, "revenue_share_pct"),
    });
  await audit(admin, "licence.added", "series", id, { licensor, territory });
  done(`/admin/series/${id}`, "Licence added.");
}

export async function updateEpisodeAction(fd: FormData) {
  const admin = await requireAdmin("content");
  const id = uuid(fd, "id");
  const seriesId = uuid(fd, "series_id");
  if (!id || !seriesId || !(await ownSeries(admin.tenantId, seriesId))) done("/admin/series", "Bad request.", "err");
  const price = num(fd, "coin_price_override");
  const { data: series } = await db().from("series").select("status").eq("id", seriesId).maybeSingle();
  const ready = str(fd, "ready", 10) === "ready";
  const patch = {
    title_ar: opt(fd, "title_ar", 200),
    title_en: opt(fd, "title_en", 200),
    stream_uid: opt(fd, "stream_uid", 64),
    wa_video_url_ar: opt(fd, "wa_video_url_ar", 500),
    wa_video_url_en: opt(fd, "wa_video_url_en", 500),
    duration_s: num(fd, "duration_s"),
    coin_price_override: price && price > 0 ? Math.round(price) : null,
    // Draft = hidden from viewers. Ready = live once the series is live (in review until then).
    status: ready ? (series?.status === "live" ? "live" : "in_review") : "draft",
    release_at: gulfTime(str(fd, "release_at", 20)),
  };
  await db().from("episodes").update(patch).eq("id", id).eq("series_id", seriesId);
  await audit(admin, "episode.updated", "episode", id, patch);
  done(`/admin/series/${seriesId}#ep-${id}`, "Episode saved.");
}

export async function addEpisodesAction(fd: FormData) {
  const admin = await requireAdmin("content");
  const seriesId = uuid(fd, "series_id");
  if (!seriesId || !(await ownSeries(admin.tenantId, seriesId))) done("/admin/series", "Bad request.", "err");
  const count = Math.min(Math.max(int(fd, "count", 1), 1), 50);
  const { data: last } = await db().from("episodes").select("number").eq("series_id", seriesId).order("number", { ascending: false }).limit(1).maybeSingle();
  const start = (last?.number ?? 0) + 1;
  await db()
    .from("episodes")
    .insert(Array.from({ length: count }, (_, i) => ({ series_id: seriesId, number: start + i, title_ar: `الحلقة ${start + i}`, title_en: `Episode ${start + i}`, status: "draft" })));
  await audit(admin, "episodes.added", "series", seriesId, { count });
  done(`/admin/series/${seriesId}`, `${count} episodes added.`);
}

// ---------------------------------------------------------------------------
// Uploads (called from the browser upload components)
// ---------------------------------------------------------------------------

const MEDIA_KINDS = { poster: ["jpg", "png", "webp"], artwork: ["jpg", "png", "webp"], clip: ["mp4"], subtitle: ["vtt"] } as const;

/** Bulk upload: make sure episodes with these numbers exist (as drafts); returns number → id. */
export async function ensureEpisodes(seriesId: string, numbers: number[]): Promise<Record<number, string>> {
  const admin = await requireAdmin("content");
  if (!(await ownSeries(admin.tenantId, seriesId))) throw new Error("Series not found.");
  const wanted = [...new Set(numbers.filter((n) => Number.isInteger(n) && n >= 1 && n <= 999))];
  const { data: have } = await db().from("episodes").select("id, number").eq("series_id", seriesId).in("number", wanted);
  const missing = wanted.filter((n) => !(have ?? []).some((e) => e.number === n));
  if (missing.length) {
    await db()
      .from("episodes")
      .insert(missing.map((n) => ({ series_id: seriesId, number: n, title_ar: `الحلقة ${n}`, title_en: `Episode ${n}`, status: "draft" })));
    await audit(admin, "episodes.added", "series", seriesId, { numbers: missing, via: "bulk_upload" });
  }
  const { data: all } = await db().from("episodes").select("id, number").eq("series_id", seriesId).in("number", wanted);
  return Object.fromEntries((all ?? []).map((e) => [e.number, e.id]));
}

/** Where the browser sends one file: Cloudflare Images (pictures) or R2 (videos, subtitles); Supabase until those are set up. */
export async function createMediaUpload(kind: keyof typeof MEDIA_KINDS, seriesCode: string, ext: string) {
  await requireAdmin("content");
  if (!(MEDIA_KINDS[kind] as readonly string[]).includes(ext)) throw new Error("File type not allowed.");
  if (!CODE_RE.test(seriesCode)) throw new Error("Bad series code.");
  return uploadTarget(`${seriesCode}/${kind}-${Date.now()}-${randomToken(6)}.${ext}`);
}

/** One-time Cloudflare Stream upload URL (web episodes). */
export async function createStreamUpload(name: string) {
  await requireAdmin("content");
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_STREAM_API_TOKEN;
  if (!account || !token) throw new Error("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_STREAM_API_TOKEN in Vercel to upload to Stream.");
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/stream/direct_upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ maxDurationSeconds: 900, meta: { name: name.slice(0, 100) } }),
  });
  const json = (await res.json()) as { success?: boolean; result?: { uploadURL: string; uid: string }; errors?: { message: string }[] };
  if (!res.ok || !json.result) throw new Error(json.errors?.[0]?.message ?? `Stream upload failed (${res.status})`);
  return { uploadUrl: json.result.uploadURL, uid: json.result.uid };
}

/** Save an uploaded file's URL / Stream id on an episode or series. */
export async function setMediaField(target: "episode" | "series", id: string, field: string, value: string) {
  const admin = await requireAdmin("content");
  const allowed =
    target === "episode"
      ? ["stream_uid", "wa_video_url_ar", "wa_video_url_en", "thumb_url", "wa_size_bytes"]
      : ["poster_url", "trailer_video_url", "banner_wide_url", "banner_wa_url", "square_url"];
  if (!allowed.includes(field) || !/^[0-9a-f-]{36}$/.test(id)) throw new Error("Bad request.");
  // Only this label's series and episodes.
  const seriesId = target === "series" ? id : (await db().from("episodes").select("series_id").eq("id", id).maybeSingle()).data?.series_id;
  if (!(await ownSeries(admin.tenantId, seriesId ?? null))) throw new Error("Not found.");
  const v = field === "wa_size_bytes" ? Math.max(0, Math.round(Number(value) || 0)) : value.slice(0, 500);
  await db().from(target === "episode" ? "episodes" : "series").update({ [field]: v }).eq("id", id);
  await audit(admin, "media.set", target, id, { field });
  revalidatePath("/admin/series");
}
