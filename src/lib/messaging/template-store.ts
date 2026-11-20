// The label's WhatsApp templates: list, create + submit to Meta, starter pack, and status sync.
// Used by the WhatsApp templates page, the flow builder's Template card, and the 15-minute cron.

import { db } from "../supabase";
import { templateIssues, templateSlug, type TemplateDraft } from "../whatsapp/template-rules";
import { editTemplateOnMeta, fetchMetaTemplates, submitTemplate, wabaConfigured, type TemplateRow } from "../whatsapp/templates";
import type { FlowGraph } from "../flows/types";

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
  // Growth agent: a tap reopens the chat and the bot sends the 3 series picked for this viewer.
  { name: "series_picks", lang: "ar", category: "marketing", header_type: "none", body: "اخترنا لك مسلسلات على ذوقك بعد «{{1}}» 🍿 اضغط وشوف اختياراتك.\n\nأرسل STOP لإيقاف التنبيهات.", button_text: "شوف اختياراتي", button_type: "quick_reply" },
  { name: "series_picks", lang: "en", category: "marketing", header_type: "none", body: "We picked series for you after “{{1}}” 🍿 Tap to see your picks.\n\nSend STOP to turn off alerts.", button_text: "See my picks", button_type: "quick_reply" },
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
  const rows: Omit<TemplateRow, "id">[] = [{ name, lang: "ar", category: d.category, header_type: "none", body: d.ar.body.trim(), button_text: d.ar.button.trim() || null, button_type: "url" }];
  if (d.en?.body.trim()) rows.push({ name, lang: "en", category: d.category, header_type: "none", body: d.en.body.trim(), button_text: d.en.button.trim() || null, button_type: "url" });
  const problems = (await Promise.all(rows.map((r) => submitRow(tenantId, r)))).filter(Boolean) as string[];
  return { ok: true, name, problems };
}

/** Add the ready-written templates (skipping any that exist) and submit them. */
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

// ---------------------------------------------------------------------------
// Editing, from the WhatsApp templates page or the flow builder's Template card (same rules, same rows)
// ---------------------------------------------------------------------------

const EDITABLE_ON_META = new Set(["APPROVED", "REJECTED", "PAUSED"]);

export type TemplateForEdit = {
  name: string;
  draft: TemplateDraft;
  status: string;
  /** Meta doesn't allow changing the category of an approved template. */
  categoryLocked: boolean;
  /** Why it can't be edited right now (waiting for Meta, made in WhatsApp Manager), or null. */
  blocked: string | null;
};

export async function getTemplateForEdit(tenantId: string, name: string): Promise<TemplateForEdit | null> {
  const { data } = await db().from("wa_templates").select("lang, category, body, button_text, header_type, meta_status").eq("tenant_id", tenantId).eq("name", name);
  const rows = data ?? [];
  const ar = rows.find((r) => r.lang === "ar");
  const en = rows.find((r) => r.lang === "en");
  if (!ar && !en) return null;
  const statuses = rows.map((r) => r.meta_status as string);
  const blocked = statuses.includes("PENDING")
    ? "Meta is still reviewing this template. You can edit it once Meta has decided."
    : rows.some((r) => r.header_type !== "none" || r.body === "(created in WhatsApp Manager)")
      ? "This template was made in WhatsApp Manager (it has an image header or content we can't read). Edit it there."
      : null;
  return {
    name,
    status: statuses.includes("APPROVED") ? "APPROVED" : (statuses[0] ?? "draft"),
    categoryLocked: statuses.includes("APPROVED"),
    blocked,
    draft: {
      title: name,
      category: ((ar ?? en)!.category as "marketing" | "utility") ?? "marketing",
      ar: { body: ar?.body ?? "", button: ar?.button_text ?? "" },
      en: en ? { body: en.body, button: en.button_text ?? "" } : null,
    },
  };
}

/** Save changes to an existing template and send them to Meta (edit if Meta has it, submit if it's a draft). */
export async function updateTemplate(tenantId: string, name: string, d: TemplateDraft): Promise<{ ok: true; problems: string[] } | { ok: false; errors: string[] }> {
  const { errors } = templateIssues({ ...d, title: d.title || name });
  if (errors.length) return { ok: false, errors };
  const current = await getTemplateForEdit(tenantId, name);
  if (!current) return { ok: false, errors: ["Template not found."] };
  if (current.blocked) return { ok: false, errors: [current.blocked] };
  const category = current.categoryLocked ? current.draft.category : d.category;

  const { data: rows } = await db().from("wa_templates").select("id, lang, meta_template_id, meta_status, button_type").eq("tenant_id", tenantId).eq("name", name);
  const langs: ["ar" | "en", { body: string; button: string }][] = [["ar", d.ar]];
  if (d.en?.body.trim()) langs.push(["en", d.en]);
  const problems: string[] = [];
  for (const [lang, v] of langs) {
    const existing = (rows ?? []).find((r) => r.lang === lang);
    const row: Omit<TemplateRow, "id"> = {
      name,
      lang,
      category,
      header_type: "none",
      body: v.body.trim(),
      button_text: v.button.trim() || null,
      button_type: (existing?.button_type as "url" | "quick_reply" | null) ?? "url",
    };
    if (existing?.meta_template_id && EDITABLE_ON_META.has(existing.meta_status)) {
      if (!wabaConfigured()) {
        problems.push("Set WHATSAPP_WABA_ID in Vercel to send edits to Meta.");
        continue;
      }
      const r = await editTemplateOnMeta(existing.meta_template_id, row, { category: !current.categoryLocked && category !== current.draft.category });
      if (!r.ok) {
        problems.push(`Meta didn't accept the ${lang === "ar" ? "Arabic" : "English"} edit: ${r.error}`);
        continue;
      }
      await db()
        .from("wa_templates")
        .update({ category, body: row.body, button_text: row.button_text, meta_status: "PENDING", meta_reason: null, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
    } else {
      const p = await submitRow(tenantId, row);
      if (p) problems.push(p);
    }
  }
  return { ok: true, problems };
}

export type TemplateUse = { kind: "flow" | "flow_draft" | "sequence" | "campaign" | "growth"; label: string; href: string; active: boolean };

/** Where each template is used: live flows (and drafts), sequences, campaigns, the growth agent. */
export async function templateUsage(tenantId: string): Promise<Map<string, TemplateUse[]>> {
  const [{ data: flows }, { data: sequences }, { data: campaigns }, { data: growth }] = await Promise.all([
    db().from("flows").select("series_id, draft, published_version_id, series(code)").eq("tenant_id", tenantId),
    db().from("sequences").select("id, name, template_name, active").eq("tenant_id", tenantId),
    db().from("campaigns").select("id, name, template_name, status").eq("tenant_id", tenantId),
    db().from("growth_settings").select("enabled").eq("tenant_id", tenantId).maybeSingle(),
  ]);
  const liveIds = (flows ?? []).map((f) => f.published_version_id).filter(Boolean) as string[];
  const { data: liveVersions } = liveIds.length ? await db().from("flow_versions").select("id, graph").in("id", liveIds) : { data: [] };
  const graphById = new Map((liveVersions ?? []).map((v) => [v.id as string, v.graph as unknown]));
  const out = new Map<string, TemplateUse[]>();
  const add = (name: string, u: TemplateUse) => {
    const list = out.get(name) ?? [];
    if (!list.some((x) => x.kind === u.kind && x.href === u.href)) list.push(u);
    out.set(name, list);
  };
  const templatesIn = (g: unknown) =>
    ((g as FlowGraph | null)?.nodes ?? []).flatMap((n) => (n.data?.kind === "template" && n.data.name ? [{ name: n.data.name, card: n.name || "Template card" }] : []));
  for (const f of flows ?? []) {
    const code = (f.series as unknown as { code: string } | null)?.code ?? "series";
    const liveNames = new Set<string>();
    for (const t of templatesIn(f.published_version_id ? graphById.get(f.published_version_id) : null)) {
      liveNames.add(t.name);
      add(t.name, { kind: "flow", label: `${code} flow · ${t.card}`, href: `/admin/flows/${f.series_id}`, active: true });
    }
    for (const t of templatesIn(f.draft)) {
      if (!liveNames.has(t.name)) add(t.name, { kind: "flow_draft", label: `${code} flow draft · ${t.card}`, href: `/admin/flows/${f.series_id}`, active: false });
    }
  }
  for (const s of sequences ?? []) add(s.template_name, { kind: "sequence", label: `Sequence · ${s.name}`, href: `/admin/sequences?edit=${s.id}`, active: s.active });
  for (const c of campaigns ?? []) {
    add(c.template_name, { kind: "campaign", label: `Campaign · ${c.name} (${c.status})`, href: "/admin/campaigns", active: c.status === "scheduled" || c.status === "sending" });
  }
  if (growth) add("series_picks", { kind: "growth", label: "Growth agent · 3 series picks", href: "/admin/growth", active: Boolean(growth.enabled) });
  return out;
}

/** In use by something that sends right now (live flow, active sequence, scheduled campaign, growth agent on). */
export const inActiveUse = (uses: TemplateUse[] | undefined) => (uses ?? []).filter((u) => u.active);
