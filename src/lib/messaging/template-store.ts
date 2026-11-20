// The label's WhatsApp templates: list, create + submit to Meta, starter pack, and status sync.
// Used by the WhatsApp templates page, the flow builder's Template card, and the 15-minute cron.

import { db } from "../supabase";
import { templateIssues, templateSlug, type TemplateDraft } from "../whatsapp/template-rules";
import { fetchMetaTemplates, submitTemplate, wabaConfigured, type TemplateRow } from "../whatsapp/templates";

export type TemplateLang = { body: string; button: string | null; status: string; reason: string | null };
export type TemplateInfo = {
  name: string;
  category: "marketing" | "utility";
  approved: boolean;
  status: string;
  bodyAr: string | null;
  ar: TemplateLang | null;
  en: TemplateLang | null;
};

export const STARTER_TEMPLATES: Omit<TemplateRow, "id">[] = [
  { name: "resume_reminder", lang: "ar", category: "marketing", header_type: "none", body: "لسه ما خلصت «{{1}}» 👀 وقفت عند الحلقة {{2}}. كمّل الحين من حيث وقفت.\n\nأرسل STOP لإيقاف التنبيهات.", button_text: "كمّل المشاهدة" },
  { name: "resume_reminder", lang: "en", category: "marketing", header_type: "none", body: "You haven't finished “{{1}}” yet 👀 You stopped at episode {{2}}. Pick up where you left off.\n\nSend STOP to turn off alerts.", button_text: "Continue watching" },
  { name: "new_series_alert", lang: "ar", category: "marketing", header_type: "none", body: "مسلسل جديد على واتشات: «{{1}}» 🎬 أول الحلقات جاهزة الحين.\n\nأرسل STOP لإيقاف التنبيهات.", button_text: "شاهد الآن" },
  { name: "new_series_alert", lang: "en", category: "marketing", header_type: "none", body: "New on Watchat: “{{1}}” 🎬 The first episodes are ready now.\n\nSend STOP to turn off alerts.", button_text: "Watch now" },
  { name: "win_back", lang: "ar", category: "marketing", header_type: "none", body: "اشتقنا لك! «{{1}}» بانتظارك 🍿 ارجع وكمّل القصة.\n\nأرسل STOP لإيقاف التنبيهات.", button_text: "رجوع للمشاهدة" },
  { name: "win_back", lang: "en", category: "marketing", header_type: "none", body: "We missed you! “{{1}}” is waiting 🍿 Come back and finish the story.\n\nSend STOP to turn off alerts.", button_text: "Back to watching" },
];

export async function listTemplates(tenantId: string): Promise<TemplateInfo[]> {
  const { data } = await db().from("wa_templates").select("name, lang, category, meta_status, meta_reason, body, button_text").eq("tenant_id", tenantId).order("name");
  const by = new Map<string, TemplateInfo>();
  for (const t of data ?? []) {
    const cur = by.get(t.name) ?? { name: t.name, category: t.category, approved: false, status: "draft", bodyAr: null, ar: null, en: null };
    const lang: TemplateLang = { body: t.body, button: t.button_text, status: t.meta_status, reason: t.meta_reason };
    if (t.lang === "ar") (cur.ar = lang), (cur.bodyAr = t.body);
    if (t.lang === "en") cur.en = lang;
    cur.approved = cur.approved || t.meta_status === "APPROVED";
    const statuses = [cur.ar?.status, cur.en?.status].filter(Boolean) as string[];
    cur.status = cur.approved ? "APPROVED" : statuses.includes("REJECTED") ? "REJECTED" : statuses.includes("PENDING") ? "PENDING" : (statuses[0] ?? "draft");
    by.set(t.name, cur);
  }
  return [...by.values()];
}

async function submitRow(tenantId: string, row: Omit<TemplateRow, "id">): Promise<string | null> {
  const { data, error } = await db()
    .from("wa_templates")
    .upsert({ ...row, tenant_id: tenantId, meta_status: "draft", meta_reason: null, updated_at: new Date().toISOString() }, { onConflict: "tenant_id,name,lang" })
    .select("id")
    .single();
  if (error || !data) return `Couldn't save ${row.name} (${row.lang}): ${error?.message}`;
  if (!wabaConfigured()) return null; // saved as draft; submit later from WhatsApp templates
  const r = await submitTemplate({ ...row, id: data.id });
  await db()
    .from("wa_templates")
    .update(r.ok ? { meta_template_id: r.metaId, meta_status: r.status, updated_at: new Date().toISOString() } : { meta_status: "draft", meta_reason: r.error, updated_at: new Date().toISOString() })
    .eq("id", data.id);
  return r.ok ? null : `Meta didn't accept ${row.name} (${row.lang}): ${r.error}`;
}

/** Save a new template in Arabic (+ English) and submit both to Meta. */
export async function createTemplate(tenantId: string, d: TemplateDraft): Promise<{ ok: true; name: string; problems: string[] } | { ok: false; errors: string[] }> {
  const { errors } = templateIssues(d);
  if (errors.length) return { ok: false, errors };
  const name = templateSlug(d.title);
  const { data: existing } = await db().from("wa_templates").select("meta_status").eq("tenant_id", tenantId).eq("name", name);
  if ((existing ?? []).some((t) => t.meta_status !== "draft" && t.meta_status !== "REJECTED")) {
    return { ok: false, errors: [`A template called "${name}" already exists with Meta. Pick another name.`] };
  }
  const rows: Omit<TemplateRow, "id">[] = [{ name, lang: "ar", category: d.category, header_type: "none", body: d.ar.body.trim(), button_text: d.ar.button.trim() || null }];
  if (d.en?.body.trim()) rows.push({ name, lang: "en", category: d.category, header_type: "none", body: d.en.body.trim(), button_text: d.en.button.trim() || null });
  const problems = (await Promise.all(rows.map((r) => submitRow(tenantId, r)))).filter(Boolean) as string[];
  return { ok: true, name, problems };
}

/** Add the three ready-written templates (skipping any that exist) and submit them. */
export async function addStarterTemplates(tenantId: string): Promise<string[]> {
  const { data } = await db().from("wa_templates").select("name, lang").eq("tenant_id", tenantId);
  const have = new Set((data ?? []).map((t) => `${t.name}:${t.lang}`));
  const todo = STARTER_TEMPLATES.filter((t) => !have.has(`${t.name}:${t.lang}`));
  return (await Promise.all(todo.map((r) => submitRow(tenantId, r)))).filter(Boolean) as string[];
}

/** Pull approval status from Meta. Templates made directly in WhatsApp Manager are added too. */
export async function syncTemplateStatuses(tenantId: string): Promise<number> {
  const remote = await fetchMetaTemplates();
  let updated = 0;
  for (const m of remote) {
    const lang = m.language.startsWith("ar") ? "ar" : m.language.startsWith("en") ? "en" : null;
    if (!lang) continue;
    const { data } = await db()
      .from("wa_templates")
      .update({ meta_template_id: m.id, meta_status: m.status, meta_reason: m.rejected_reason && m.rejected_reason !== "NONE" ? m.rejected_reason : null, updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("name", m.name)
      .eq("lang", lang)
      .select("id");
    if (!data?.length) {
      await db()
        .from("wa_templates")
        .insert({ tenant_id: tenantId, name: m.name, lang, category: m.category?.toLowerCase() === "utility" ? "utility" : "marketing", body: "(created in WhatsApp Manager)", meta_template_id: m.id, meta_status: m.status });
    }
    updated++;
  }
  return updated;
}
