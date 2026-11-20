"use server";

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

export async function saveTemplateAction(fd: FormData) {
  const admin = await requireAdmin("messaging");
  const name = str(fd, "name", 100).toLowerCase();
  const lang = str(fd, "lang", 2);
  const category = str(fd, "category", 20);
  const body = str(fd, "body", 1024);
  if (!/^[a-z0-9_]{1,100}$/.test(name)) done("/admin/templates", "Name: lowercase letters, numbers and _ only.", "err");
  if (lang !== "ar" && lang !== "en") done("/admin/templates", "Pick a language.", "err");
  if (category !== "marketing" && category !== "utility") done("/admin/templates", "Pick a category.", "err");
  if (!body) done("/admin/templates", "Body is required.", "err");
  const buttonText = opt(fd, "button_text", 25);
  const { error } = await db()
    .from("wa_templates")
    .upsert(
      {
        tenant_id: admin.tenantId,
        name,
        lang,
        category,
        header_type: str(fd, "header_type", 10) === "image" ? "image" : "none",
        body,
        button_text: buttonText,
        meta_status: "draft",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,name,lang" },
    );
  if (error) done("/admin/templates", `Save failed: ${error.message}`, "err");
  await audit(admin, "template.saved", "wa_template", `${name}:${lang}`);
  done("/admin/templates", `Template ${name} (${lang}) saved as draft.`);
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

export async function deleteTemplateAction(fd: FormData) {
  const admin = await requireAdmin("messaging");
  const id = uuid(fd, "id");
  if (!id) done("/admin/templates", "Bad request.", "err");
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
