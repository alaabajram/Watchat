"use server";

import { createTemplate, inActiveUse, templateUsage, updateTemplate } from "@/lib/messaging/template-store";
import type { TemplateDraft } from "@/lib/whatsapp/template-rules";
import { audit, requireAdmin } from "@/lib/admin/auth";
import { bool, done, int, opt, str, uuid } from "@/lib/admin/forms";
import { estimateCost } from "@/lib/messaging/policy";
import { db } from "@/lib/supabase";
import { addStarterTemplates, syncTemplateStatuses } from "@/lib/messaging/template-store";
import { submitTemplate, type TemplateRow } from "@/lib/whatsapp/templates";

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export async function addStarterTemplatesAction() {
  const admin = await requireAdmin("messaging");
  const problems = await addStarterTemplates(admin.tenantId);
  await audit(admin, "templates.starters_added", "wa_templates");
  done("/admin/templates", problems.length ? problems.join(" ") : "Starter templates added and sent to Meta for approval.", problems.length ? "err" : "ok");
}

export async function submitTemplateAction(fd: FormData) {
  const admin = await requireAdmin("messaging");
  const id = uuid(fd, "id");
  if (!id) done("/admin/templates", "Bad request.", "err");
  const { data: t } = await db().from("wa_templates").select("*").eq("id", id).eq("tenant_id", admin.tenantId).maybeSingle();
  if (!t) done("/admin/templates", "Template not found.", "err");
  const result = await submitTemplate(t as TemplateRow);
  if (!result.ok) done("/admin/templates", `Meta rejected the request: ${result.error}`, "err");
  await db()
    .from("wa_templates")
    .update({ meta_template_id: result.metaId, meta_status: result.status, meta_reason: null, updated_at: new Date().toISOString() })
    .eq("id", id);
  await audit(admin, "template.submitted", "wa_template", id, { name: t.name, lang: t.lang });
  done("/admin/templates", `${t.name} (${t.lang}) sent to Meta for approval. Use "Sync from Meta" to see the result.`);
}

export async function syncTemplatesAction() {
  const admin = await requireAdmin("messaging");
  let updated = 0;
  try {
    updated = await syncTemplateStatuses(admin.tenantId);
  } catch (e) {
    done("/admin/templates", e instanceof Error ? e.message : "Sync failed.", "err");
  }
  await audit(admin, "templates.synced", "wa_templates", null, { count: updated });
  done("/admin/templates", `Synced ${updated} templates from Meta.`);
}

/** New or edited template from the shared editor on the WhatsApp templates page (Arabic + English together). */
export async function saveTemplateFromPage(draft: TemplateDraft, editing: string | null): Promise<{ ok: boolean; message: string; name?: string }> {
  const admin = await requireAdmin("messaging");
  const d: TemplateDraft = {
    title: String(draft?.title ?? "").slice(0, 80),
    category: draft?.category === "utility" ? "utility" : "marketing",
    ar: { body: String(draft?.ar?.body ?? "").slice(0, 1100), button: String(draft?.ar?.button ?? "").slice(0, 40) },
    en: draft?.en?.body?.trim() ? { body: String(draft.en.body).slice(0, 1100), button: String(draft.en.button ?? "").slice(0, 40) } : null,
  };
  if (editing) {
    const r = await updateTemplate(admin.tenantId, String(editing).slice(0, 100), d);
    if (!r.ok) return { ok: false, message: r.errors.join(" ") };
    await audit(admin, "template.edited", "wa_template", editing, { from: "templates_page" });
    return { ok: !r.problems.length, name: editing, message: r.problems.length ? r.problems.join(" ") : `"${editing}" updated and sent to Meta for review.` };
  }
  const r = await createTemplate(admin.tenantId, d);
  if (!r.ok) return { ok: false, message: r.errors.join(" ") };
  await audit(admin, "template.created", "wa_template", r.name, { from: "templates_page", category: d.category });
  return { ok: !r.problems.length, name: r.name, message: r.problems.length ? r.problems.join(" ") : `"${r.name}" saved and sent to Meta for approval.` };
}

export async function deleteTemplateAction(fd: FormData) {
  const admin = await requireAdmin("messaging");
  const id = uuid(fd, "id");
  if (!id) done("/admin/templates", "Bad request.", "err");
  const { data: row } = await db().from("wa_templates").select("name").eq("id", id).eq("tenant_id", admin.tenantId).maybeSingle();
  const busy = row ? inActiveUse((await templateUsage(admin.tenantId)).get(row.name)) : [];
  if (busy.length) done("/admin/templates", `"${row!.name}" is in use (${busy.map((u) => u.label).join(", ")}). Switch those to another template first.`, "err");
  await db().from("wa_templates").delete().eq("id", id).eq("tenant_id", admin.tenantId);
  await audit(admin, "template.deleted", "wa_template", id);
  done("/admin/templates", "Template removed here (it stays in WhatsApp Manager).");
}

// ---------------------------------------------------------------------------
// Sequences
// ---------------------------------------------------------------------------

const TRIGGERS = ["stopped_mid_series", "inactive", "finished_series"] as const;

export async function saveSequenceAction(fd: FormData) {
  const admin = await requireAdmin("messaging");
  const id = uuid(fd, "id");
  const trigger = str(fd, "trigger", 30);
  const delay = int(fd, "delay_hours", 24);
  const name = str(fd, "name", 100);
  const template = str(fd, "template_name", 100);
  if (!name || !template) done("/admin/sequences", "Name and template are required.", "err");
  if (!(TRIGGERS as readonly string[]).includes(trigger)) done("/admin/sequences", "Pick a trigger.", "err");
  if (delay < 1 || delay > 2160) done("/admin/sequences", "Delay must be 1–2160 hours.", "err");
  const row = {
    tenant_id: admin.tenantId,
    name,
    trigger,
    delay_hours: delay,
    template_name: template,
    series_id: uuid(fd, "series_id"),
    active: bool(fd, "active"),
    updated_at: new Date().toISOString(),
  };
  const { error } = id
    ? await db().from("sequences").update(row).eq("id", id).eq("tenant_id", admin.tenantId)
    : await db().from("sequences").insert(row);
  if (error) done("/admin/sequences", `Save failed: ${error.message}`, "err");
  await audit(admin, id ? "sequence.updated" : "sequence.created", "sequence", id, row);
  done("/admin/sequences", `Sequence "${name}" saved${row.active ? " and active" : " (paused)"}.`);
}

export async function toggleSequenceAction(fd: FormData) {
  const admin = await requireAdmin("messaging");
  const id = uuid(fd, "id");
  if (!id) done("/admin/sequences", "Bad request.", "err");
  const active = str(fd, "active", 5) === "true";
  await db().from("sequences").update({ active, updated_at: new Date().toISOString() }).eq("id", id).eq("tenant_id", admin.tenantId);
  await audit(admin, active ? "sequence.activated" : "sequence.paused", "sequence", id);
  done("/admin/sequences", active ? "Sequence activated." : "Sequence paused.");
}

export async function deleteSequenceAction(fd: FormData) {
  const admin = await requireAdmin("messaging");
  const id = uuid(fd, "id");
  if (!id) done("/admin/sequences", "Bad request.", "err");
  await db().from("sequences").delete().eq("id", id).eq("tenant_id", admin.tenantId);
  await audit(admin, "sequence.deleted", "sequence", id);
  done("/admin/sequences", "Sequence deleted.");
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

function segmentFrom(fd: FormData): Record<string, string | number | boolean> {
  const seg: Record<string, string | number | boolean> = {};
  const series = uuid(fd, "seg_series_id");
  if (series) seg.series_id = series;
  const language = str(fd, "seg_language", 20);
  if (language === "ar" || language === "ar_en_subs") seg.language = language;
  const country = str(fd, "seg_country", 2).toUpperCase();
  if (/^[A-Z]{2}$/.test(country)) seg.country = country;
  const paid = str(fd, "seg_paid", 5);
  if (paid === "true" || paid === "false") seg.paid = paid === "true";
  const inactive = int(fd, "seg_inactive_days", 0);
  if (inactive > 0) seg.inactive_days = inactive;
  const active = int(fd, "seg_active_within_days", 0);
  if (active > 0) seg.active_within_days = active;
  return seg;
}

export async function saveCampaignAction(fd: FormData) {
  const admin = await requireAdmin("messaging");
  const name = str(fd, "name", 120);
  const template = str(fd, "template_name", 100);
  if (!name || !template) done("/admin/campaigns", "Name and template are required.", "err");
  const segment = segmentFrom(fd);

  const [{ data: audience, error }, { data: tpl }] = await Promise.all([
    db().rpc("campaign_audience", { p_tenant: admin.tenantId, p_segment: segment }),
    db().from("wa_templates").select("category").eq("tenant_id", admin.tenantId).eq("name", template).limit(1).maybeSingle(),
  ]);
  if (error) done("/admin/campaigns", `Audience query failed: ${error.message}`, "err");
  const list = (audience ?? []) as { country: string | null }[];
  const cost = estimateCost(tpl?.category === "utility" ? "utility" : "marketing", list.map((a) => a.country));

  const { data: created, error: insertError } = await db()
    .from("campaigns")
    .insert({
      tenant_id: admin.tenantId,
      name,
      template_name: template,
      series_id: uuid(fd, "series_id"),
      segment,
      status: "draft",
      audience_count: list.length,
      estimated_cost_usd: cost,
      created_by: admin.id,
    })
    .select("id")
    .single();
  if (insertError || !created) done("/admin/campaigns", `Save failed: ${insertError?.message}`, "err");
  await audit(admin, "campaign.created", "campaign", created.id, { segment, audience: list.length, cost });
  done("/admin/campaigns", `Draft saved: ${list.length} opted-in viewers, about $${cost.toFixed(2)} in WhatsApp fees.`);
}

export async function scheduleCampaignAction(fd: FormData) {
  const admin = await requireAdmin("messaging");
  const id = uuid(fd, "id");
  const when = str(fd, "scheduled_at", 20); // datetime-local, Gulf time
  if (!id || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(when)) done("/admin/campaigns", "Pick a date and time.", "err");
  const at = new Date(`${when}:00+04:00`);
  if (Number.isNaN(at.getTime())) done("/admin/campaigns", "Bad date.", "err");
  const { data: tpl } = await db()
    .from("campaigns")
    .select("template_name, status")
    .eq("id", id)
    .eq("tenant_id", admin.tenantId)
    .single();
  if (!tpl || (tpl.status !== "draft" && tpl.status !== "scheduled")) done("/admin/campaigns", "Only drafts can be scheduled.", "err");
  const { count } = await db()
    .from("wa_templates")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", admin.tenantId)
    .eq("name", tpl.template_name)
    .eq("meta_status", "APPROVED");
  if (!count) done("/admin/campaigns", `Template "${tpl.template_name}" isn't approved by Meta yet.`, "err");
  await db().from("campaigns").update({ status: "scheduled", scheduled_at: at.toISOString(), updated_at: new Date().toISOString() }).eq("id", id);
  await audit(admin, "campaign.scheduled", "campaign", id, { at: at.toISOString() });
  done("/admin/campaigns", "Campaign scheduled. It sends outside quiet hours (22:00–09:00 Gulf time).");
}

export async function cancelCampaignAction(fd: FormData) {
  const admin = await requireAdmin("messaging");
  const id = uuid(fd, "id");
  if (!id) done("/admin/campaigns", "Bad request.", "err");
  await db()
    .from("campaigns")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", admin.tenantId)
    .in("status", ["draft", "scheduled", "sending"]);
  await audit(admin, "campaign.cancelled", "campaign", id);
  done("/admin/campaigns", "Campaign cancelled.");
}
