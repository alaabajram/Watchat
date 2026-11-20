// Sends due sequence messages and scheduled campaigns. Called by the cron route every 15 minutes.
// Safety rules applied to every send: opted-in viewers only (enforced in SQL), approved templates only,
// quiet hours, one marketing message per viewer per MARKETING_GAP_HOURS, and a unique row per
// (sequence|campaign, viewer, moment) written BEFORE sending so overlapping runs can never double-send.

import { mintLink } from "../links";
import { currentTenantId, db } from "../supabase";
import { sendWhatsApp } from "../whatsapp/client";
import { placeholderCount } from "../whatsapp/templates";
import { isQuietHours, MARKETING_GAP_HOURS, templateLangFor } from "./policy";

type Template = {
  name: string;
  lang: "ar" | "en";
  category: "marketing" | "utility";
  header_type: "none" | "image";
  body: string;
  button_text: string | null;
  meta_status: string;
};

type SeriesInfo = { id: string; code: string; title_ar: string; title_en: string; poster_url: string | null; wa_episode_count: number };

type Recipient = {
  viewerId: string;
  phone: string; // E.164
  language: string | null;
  seriesId: string | null;
  episode: number | null;
};

export type RunSummary = { quietHours: boolean; sequences: Record<string, number>; campaigns: Record<string, number>; skipped: number; failed: number };

const MAX_SENDS_PER_RUN = 400;

async function loadTemplates(tenantId: string, name: string): Promise<Map<string, Template>> {
  const { data } = await db()
    .from("wa_templates")
    .select("name, lang, category, header_type, body, button_text, meta_status")
    .eq("tenant_id", tenantId)
    .eq("name", name);
  return new Map((data ?? []).map((t) => [t.lang as string, t as Template]));
}

const seriesCache = new Map<string, SeriesInfo | null>();
async function getSeries(id: string | null): Promise<SeriesInfo | null> {
  if (!id) return null;
  if (!seriesCache.has(id)) {
    const { data } = await db()
      .from("series")
      .select("id, code, title_ar, title_en, poster_url, wa_episode_count")
      .eq("id", id)
      .maybeSingle();
    seriesCache.set(id, (data as SeriesInfo) ?? null);
  }
  return seriesCache.get(id) ?? null;
}

async function recentlyMarketed(viewerId: string): Promise<boolean> {
  const since = new Date(Date.now() - MARKETING_GAP_HOURS * 3600 * 1000).toISOString();
  const { count } = await db()
    .from("wa_messages")
    .select("id", { count: "exact", head: true })
    .eq("viewer_id", viewerId)
    .eq("category", "marketing")
    .neq("status", "failed")
    .gte("created_at", since);
  return (count ?? 0) > 0;
}

/** Send a template by name from a flow's Template card. Marketing templates need the viewer's opt-in. */
export async function sendNamedTemplate(r: Recipient, name: string, optedIn: boolean): Promise<"sent" | "skipped" | "failed"> {
  const tenantId = await currentTenantId();
  const templates = await loadTemplates(tenantId, name);
  const t = templates.get(templateLangFor(r.language)) ?? templates.get("ar");
  if (t?.category === "marketing" && !optedIn) return "skipped";
  const result = await sendTemplate(r, templates);
  return result.ok ? "sent" : result.skipped ? "skipped" : "failed";
}

/** Send one template to one viewer. Returns the Meta message id or an error. */
async function sendTemplate(r: Recipient, templates: Map<string, Template>): Promise<{ ok: boolean; id?: string; error?: string; skipped?: boolean }> {
  const lang = templateLangFor(r.language);
  const template = templates.get(lang) ?? templates.get("ar");
  if (!template || template.meta_status !== "APPROVED") return { ok: false, skipped: true, error: "template not approved" };
  if (template.category === "marketing" && (await recentlyMarketed(r.viewerId))) return { ok: false, skipped: true, error: "frequency cap" };

  const series = await getSeries(r.seriesId);
  const title = series ? (template.lang === "en" ? series.title_en : series.title_ar) : "Watchat";
  const params = [title, String(r.episode ?? "")].slice(0, placeholderCount(template.body));

  let urlParam: string | undefined;
  if (template.button_text && series) {
    const episode = Math.max(r.episode ?? 0, series.wa_episode_count + 1);
    const url = await mintLink({ viewerId: r.viewerId, seriesId: series.id, episodeNumber: episode, purpose: "resume" });
    urlParam = url.split("/w/")[1];
  }

  const result = await sendWhatsApp(r.phone.replace(/^\+/, ""), {
    kind: "template",
    name: template.name,
    language: template.lang,
    ...(template.header_type === "image" && series?.poster_url ? { headerImage: series.poster_url } : {}),
    bodyParams: params,
    ...(urlParam ? { urlButtonParam: urlParam } : {}),
  });

  await db()
    .from("wa_messages")
    .insert({
      viewer_id: r.viewerId,
      direction: "out",
      wa_message_id: result.ok ? result.waMessageId : null,
      kind: "template",
      template_name: template.name,
      category: template.category,
      status: result.ok ? "sent" : "failed",
      error: result.ok ? null : result.error,
    });
  return result.ok ? { ok: true, id: result.waMessageId } : { ok: false, error: result.error };
}

export async function runMessaging(now = new Date()): Promise<RunSummary> {
  const summary: RunSummary = { quietHours: isQuietHours(now), sequences: {}, campaigns: {}, skipped: 0, failed: 0 };
  if (summary.quietHours) return summary;

  const tenantId = await currentTenantId();
  let budget = MAX_SENDS_PER_RUN;

  // --- Sequences --------------------------------------------------------------------------
  const { data: sequences } = await db()
    .from("sequences")
    .select("id, name, template_name")
    .eq("tenant_id", tenantId)
    .eq("active", true);

  for (const seq of sequences ?? []) {
    if (budget <= 0) break;
    const templates = await loadTemplates(tenantId, seq.template_name);
    // Don't use up anyone's moment while the template is still waiting for Meta's approval.
    if (![...templates.values()].some((t) => t.meta_status === "APPROVED")) continue;
    const { data: candidates, error } = await db().rpc("sequence_candidates", { p_sequence: seq.id });
    if (error) {
      console.error("[messaging] candidates failed", seq.id, error.message);
      continue;
    }
    let sent = 0;
    for (const c of (candidates ?? []) as {
      viewer_id: string;
      phone_e164: string;
      language: string;
      series_id: string | null;
      episode_number: number | null;
      ref: string;
    }[]) {
      if (budget <= 0) break;
      // Claim this moment first; a duplicate run gets a unique-violation and moves on.
      const { error: claimError } = await db()
        .from("sequence_sends")
        .insert({ sequence_id: seq.id, viewer_id: c.viewer_id, ref: c.ref, status: "sending" });
      if (claimError) continue;
      budget--;
      const r = await sendTemplate(
        { viewerId: c.viewer_id, phone: c.phone_e164, language: c.language, seriesId: c.series_id, episode: c.episode_number },
        templates,
      );
      await db()
        .from("sequence_sends")
        .update({ status: r.ok ? "sent" : r.skipped ? "skipped" : "failed", wa_message_id: r.id ?? null, error: r.error ?? null })
        .eq("sequence_id", seq.id)
        .eq("viewer_id", c.viewer_id)
        .eq("ref", c.ref);
      if (r.ok) sent++;
      else if (r.skipped) summary.skipped++;
      else summary.failed++;
    }
    summary.sequences[seq.name] = sent;
  }

  // --- Campaigns --------------------------------------------------------------------------
  const { data: campaigns } = await db()
    .from("campaigns")
    .select("id, name, template_name, series_id, segment, status")
    .eq("tenant_id", tenantId)
    .in("status", ["scheduled", "sending"])
    .lte("scheduled_at", now.toISOString());

  for (const camp of campaigns ?? []) {
    if (budget <= 0) break;
    const templates = await loadTemplates(tenantId, camp.template_name);
    if (![...templates.values()].some((t) => t.meta_status === "APPROVED")) continue;
    if (camp.status === "scheduled") await db().from("campaigns").update({ status: "sending" }).eq("id", camp.id);

    const { data: audience } = await db().rpc("campaign_audience", { p_tenant: tenantId, p_segment: camp.segment ?? {} });
    const { data: done } = await db().from("campaign_sends").select("viewer_id").eq("campaign_id", camp.id);
    const already = new Set((done ?? []).map((d) => d.viewer_id as string));
    const pending = ((audience ?? []) as { viewer_id: string; phone_e164: string; language: string }[]).filter(
      (a) => !already.has(a.viewer_id),
    );

    let sent = 0;
    let failed = 0;
    for (const a of pending) {
      if (budget <= 0) break;
      const { error: claimError } = await db()
        .from("campaign_sends")
        .insert({ campaign_id: camp.id, viewer_id: a.viewer_id, status: "sending" });
      if (claimError) continue;
      budget--;
      const r = await sendTemplate(
        { viewerId: a.viewer_id, phone: a.phone_e164, language: a.language, seriesId: camp.series_id, episode: null },
        templates,
      );
      await db()
        .from("campaign_sends")
        .update({ status: r.ok ? "sent" : r.skipped ? "skipped" : "failed", wa_message_id: r.id ?? null, error: r.error ?? null })
        .eq("campaign_id", camp.id)
        .eq("viewer_id", a.viewer_id);
      if (r.ok) sent++;
      else if (r.skipped) summary.skipped++;
      else failed++;
    }

    const { count: sentTotal } = await db()
      .from("campaign_sends")
      .select("viewer_id", { count: "exact", head: true })
      .eq("campaign_id", camp.id)
      .eq("status", "sent");
    const { count: failedTotal } = await db()
      .from("campaign_sends")
      .select("viewer_id", { count: "exact", head: true })
      .eq("campaign_id", camp.id)
      .eq("status", "failed");
    // If the run's budget wasn't exhausted, every pending viewer was processed.
    const finished = budget > 0;
    await db()
      .from("campaigns")
      .update({
        sent_count: sentTotal ?? 0,
        failed_count: failedTotal ?? 0,
        status: finished ? "sent" : "sending",
        updated_at: new Date().toISOString(),
      })
      .eq("id", camp.id);
    summary.campaigns[camp.name] = sent;
    summary.failed += failed;
  }

  return summary;
}
