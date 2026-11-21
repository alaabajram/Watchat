"use server";

// Flow builder actions: save draft, publish (after checks), versions, and the series media library.

import { after } from "next/server";
import { learnLessons, recordPublished } from "@/lib/ai/flow-agent";
import { audit, can, requireAdmin } from "@/lib/admin/auth";
import { addStarterTemplates, createTemplate, listTemplates, syncTemplateStatuses, type TemplateInfo, getTemplateForEdit, templateUsage, updateTemplate, type TemplateForEdit, type TemplateUse } from "@/lib/messaging/template-store";
import type { TemplateDraft } from "@/lib/whatsapp/template-rules";
import { wabaConfigured } from "@/lib/whatsapp/templates";
import { randomToken } from "@/lib/crypto";
import { assetIdsIn, sanitizeBlock, sanitizeGraph } from "@/lib/flows/sanitize";
import { canvasRow, listMyCards, loadBuilder, standardFlowFor, type Asset, type SavedCard } from "@/lib/flows/store";
import { allow } from "@/lib/security/rate-limit";
import type { FlowChannel, FlowGraph } from "@/lib/flows/types";
import { hasErrors, validateFlow, type Issue } from "@/lib/flows/validate";
import { db } from "@/lib/supabase";

const UUID = /^[0-9a-f-]{36}$/;

/** The canvas being edited: the Telegram flow of a split series, or its WhatsApp / one-for-both flow. */
async function flowFor(tenantId: string, seriesId: string, want: "telegram" | null = null) {
  if (!UUID.test(seriesId)) throw new Error("Bad series id");
  const { data: rows } = await db().from("flows").select("id, published_version_id, draft, channel").eq("tenant_id", tenantId).eq("series_id", seriesId);
  const data = canvasRow((rows ?? []) as { id: string; published_version_id: string | null; draft: unknown; channel: FlowChannel }[], want);
  if (!data) throw new Error("Open the flow builder for this series first.");
  return data;
}

const asWant = (channel?: string | null): "telegram" | null => (channel === "telegram" ? "telegram" : null);

/**
 * Give Telegram its own flow: the series' flow (draft and live version) is copied to a Telegram flow, and the
 * original becomes the WhatsApp flow. Both start identical; edit either on its own from then on.
 */
export async function splitFlow(seriesId: string): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireAdmin("bot");
  const flow = await flowFor(admin.tenantId, seriesId);
  if (flow.channel === "whatsapp") return { ok: true }; // already split
  const { data: tg, error } = await db()
    .from("flows")
    .insert({ tenant_id: admin.tenantId, series_id: seriesId, channel: "telegram", draft: flow.draft, draft_updated_by: admin.id })
    .select("id")
    .single();
  if (error || !tg) return { ok: false, error: error?.message ?? "Couldn't create the Telegram flow." };
  if (flow.published_version_id) {
    const { data: live } = await db().from("flow_versions").select("graph").eq("id", flow.published_version_id).single();
    const { data: v } = await db()
      .from("flow_versions")
      .insert({ tenant_id: admin.tenantId, flow_id: tg.id, version: 1, graph: live?.graph, note: "Copied from the WhatsApp + Telegram flow", published_by: admin.id })
      .select("id")
      .single();
    if (v) await db().from("flows").update({ published_version_id: v.id }).eq("id", tg.id);
  }
  await db().from("flows").update({ channel: "whatsapp" }).eq("id", flow.id);
  await audit(admin, "flow.split", "series", seriesId, {});
  return { ok: true };
}

/** One flow for both apps again: the Telegram flow is removed and the WhatsApp flow runs for everyone. */
export async function mergeFlow(seriesId: string): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireAdmin("bot");
  if (!UUID.test(seriesId)) return { ok: false, error: "Bad series id" };
  await db().from("flows").delete().eq("tenant_id", admin.tenantId).eq("series_id", seriesId).eq("channel", "telegram");
  await db().from("flows").update({ channel: "both" }).eq("tenant_id", admin.tenantId).eq("series_id", seriesId).eq("channel", "whatsapp");
  await audit(admin, "flow.merged", "series", seriesId, {});
  return { ok: true };
}

async function checkCtx(tenantId: string, seriesId: string) {
  const [{ count }, { data: templates }, { data: live }] = await Promise.all([
    db().from("episodes").select("id", { count: "exact", head: true }).eq("series_id", seriesId),
    db().from("wa_templates").select("name, meta_status").eq("tenant_id", tenantId),
    db().from("series").select("code").eq("tenant_id", tenantId).eq("status", "live").neq("id", seriesId),
  ]);
  const names = new Map<string, boolean>();
  for (const t of templates ?? []) names.set(t.name, (names.get(t.name) ?? false) || t.meta_status === "APPROVED");
  return { episodeCount: count ?? 0, templates: [...names].map(([name, approved]) => ({ name, approved })), seriesCodes: (live ?? []).map((s) => s.code as string) };
}

export async function saveFlowDraft(seriesId: string, graph: unknown, channel?: string | null): Promise<{ ok: true; savedAt: string } | { ok: false; error: string }> {
  const admin = await requireAdmin("bot");
  const clean = sanitizeGraph(graph);
  if (!clean) return { ok: false, error: "The flow is too big or malformed." };
  const flow = await flowFor(admin.tenantId, seriesId, asWant(channel));
  const savedAt = new Date().toISOString();
  const { error } = await db().from("flows").update({ draft: clean, draft_updated_at: savedAt, draft_updated_by: admin.id }).eq("id", flow.id);
  return error ? { ok: false, error: error.message } : { ok: true, savedAt };
}

export async function checkFlow(seriesId: string, graph: unknown): Promise<Issue[]> {
  const admin = await requireAdmin("bot");
  const clean = sanitizeGraph(graph);
  if (!clean) return [{ level: "error", message: "The flow is too big or malformed." }];
  return validateFlow(clean, await checkCtx(admin.tenantId, seriesId));
}

export async function publishFlow(
  seriesId: string,
  graph: unknown,
  note: string,
  channel?: string | null,
): Promise<{ ok: true; version: number; versionId: string; issues: Issue[] } | { ok: false; issues: Issue[]; error?: string }> {
  const admin = await requireAdmin("bot");
  const clean = sanitizeGraph(graph);
  if (!clean) return { ok: false, issues: [], error: "The flow is too big or malformed." };
  const issues = validateFlow(clean, await checkCtx(admin.tenantId, seriesId));
  if (hasErrors(issues)) return { ok: false, issues };

  const flow = await flowFor(admin.tenantId, seriesId, asWant(channel));
  const { data: last } = await db().from("flow_versions").select("version").eq("flow_id", flow.id).order("version", { ascending: false }).limit(1).maybeSingle();
  const version = (last?.version ?? 0) + 1;
  const { data: v, error } = await db()
    .from("flow_versions")
    .insert({ tenant_id: admin.tenantId, flow_id: flow.id, version, graph: clean, note: note.slice(0, 300) || null, published_by: admin.id })
    .select("id")
    .single();
  if (error || !v) return { ok: false, issues, error: error?.message ?? "Publish failed" };
  await db().from("flows").update({ draft: clean, draft_updated_at: new Date().toISOString(), draft_updated_by: admin.id, published_version_id: v.id }).eq("id", flow.id);
  await audit(admin, "flow.published", "series", seriesId, { version, cards: clean.nodes.length, channel: flow.channel });
  // Build with AI learns from what the team changed in its draft before publishing.
  after(async () => {
    if (await recordPublished(admin.tenantId, "series", seriesId, clean)) await learnLessons(admin.tenantId, admin.id, "series");
  });
  return { ok: true, version, versionId: v.id, issues };
}

export async function loadVersion(seriesId: string, versionId: string, channel?: string | null): Promise<FlowGraph | null> {
  const admin = await requireAdmin("bot");
  const flow = await flowFor(admin.tenantId, seriesId, asWant(channel));
  if (!UUID.test(versionId)) return null;
  const { data } = await db().from("flow_versions").select("graph").eq("flow_id", flow.id).eq("id", versionId).maybeSingle();
  return data ? sanitizeGraph(data.graph) : null;
}

export async function standardFlow(seriesId: string): Promise<FlowGraph | null> {
  const admin = await requireAdmin("bot");
  if (!UUID.test(seriesId)) return null;
  return standardFlowFor(admin.tenantId, seriesId);
}

// ---------------------------------------------------------------------------
// My cards: reusable cards and groups of connected cards, shared by every series of the label
// ---------------------------------------------------------------------------

export async function saveMyCards(name: string, block: unknown): Promise<{ ok: boolean; cards: SavedCard[]; message: string }> {
  const admin = await requireAdmin("bot");
  const clean = sanitizeBlock(block);
  const label = String(name ?? "").trim().slice(0, 80);
  if (!label) return { ok: false, cards: await listMyCards(admin.tenantId), message: "Give it a name." };
  if (!clean) return { ok: false, cards: await listMyCards(admin.tenantId), message: "Select one or more cards (not Start) to save." };
  const { error } = await db().from("saved_cards").insert({ tenant_id: admin.tenantId, name: label, block: clean, card_count: clean.nodes.length, created_by: admin.id });
  if (!error) await audit(admin, "my_cards.saved", "saved_card", null, { name: label, cards: clean.nodes.length });
  return { ok: !error, cards: await listMyCards(admin.tenantId), message: error ? error.message : `Saved "${label}" to My cards.` };
}

export async function renameMyCard(id: string, name: string): Promise<SavedCard[]> {
  const admin = await requireAdmin("bot");
  const label = String(name ?? "").trim().slice(0, 80);
  if (UUID.test(id) && label) await db().from("saved_cards").update({ name: label, updated_at: new Date().toISOString() }).eq("tenant_id", admin.tenantId).eq("id", id);
  return listMyCards(admin.tenantId);
}

export async function deleteMyCard(id: string): Promise<SavedCard[]> {
  const admin = await requireAdmin("bot");
  if (UUID.test(id)) {
    await db().from("saved_cards").delete().eq("tenant_id", admin.tenantId).eq("id", id);
    await audit(admin, "my_cards.deleted", "saved_card", id);
  }
  return listMyCards(admin.tenantId);
}

// ---------------------------------------------------------------------------
// WhatsApp templates from the Template card (needs the Messaging permission, like the templates page)
// ---------------------------------------------------------------------------

type TemplatesResult = { ok: boolean; templates: TemplateInfo[]; message?: string; name?: string };
const NO_MESSAGING = "Creating templates needs the Messaging permission (owner or marketing). Ask them to add it on the WhatsApp templates page.";

export async function createTemplateFromBuilder(draft: TemplateDraft): Promise<TemplatesResult> {
  const admin = await requireAdmin("bot");
  if (!can(admin, "messaging")) return { ok: false, templates: await listTemplates(admin.tenantId), message: NO_MESSAGING };
  const d: TemplateDraft = {
    title: String(draft?.title ?? "").slice(0, 80),
    category: draft?.category === "utility" ? "utility" : "marketing",
    ar: { body: String(draft?.ar?.body ?? "").slice(0, 1100), button: String(draft?.ar?.button ?? "").slice(0, 40) },
    en: draft?.en ? { body: String(draft.en.body ?? "").slice(0, 1100), button: String(draft.en.button ?? "").slice(0, 40) } : null,
  };
  const r = await createTemplate(admin.tenantId, d);
  const templates = await listTemplates(admin.tenantId);
  if (!r.ok) return { ok: false, templates, message: r.errors.join(" ") };
  await audit(admin, "template.created", "wa_template", r.name, { from: "flow_builder", category: d.category });
  const where = wabaConfigured() ? "sent to Meta for approval (usually minutes, sometimes a few hours)" : "saved as a draft (set WHATSAPP_WABA_ID in Vercel to submit to Meta)";
  return { ok: true, templates, name: r.name, message: r.problems.length ? r.problems.join(" ") : `Template "${r.name}" ${where}.` };
}

function cleanDraft(draft: TemplateDraft): TemplateDraft {
  return {
    title: String(draft?.title ?? "").slice(0, 80),
    category: draft?.category === "utility" ? "utility" : "marketing",
    ar: { body: String(draft?.ar?.body ?? "").slice(0, 1100), button: String(draft?.ar?.button ?? "").slice(0, 40) },
    en: draft?.en ? { body: String(draft.en.body ?? "").slice(0, 1100), button: String(draft.en.button ?? "").slice(0, 40) } : null,
  };
}

/** A template to edit on the Template card, with where else it's used. */
export async function templateForEditFromBuilder(name: string): Promise<{ template: TemplateForEdit | null; uses: TemplateUse[] }> {
  const admin = await requireAdmin("bot");
  const [template, usage] = await Promise.all([getTemplateForEdit(admin.tenantId, String(name).slice(0, 100)), templateUsage(admin.tenantId)]);
  return { template, uses: usage.get(name) ?? [] };
}

/** Edit from the Template card: the same template the WhatsApp templates page shows. */
export async function updateTemplateFromBuilder(name: string, draft: TemplateDraft): Promise<TemplatesResult> {
  const admin = await requireAdmin("bot");
  if (!can(admin, "messaging")) return { ok: false, templates: await listTemplates(admin.tenantId), message: NO_MESSAGING };
  const r = await updateTemplate(admin.tenantId, String(name).slice(0, 100), cleanDraft(draft));
  const templates = await listTemplates(admin.tenantId);
  if (!r.ok) return { ok: false, templates, message: r.errors.join(" ") };
  await audit(admin, "template.edited", "wa_template", name, { from: "flow_builder" });
  return { ok: !r.problems.length, templates, name, message: r.problems.length ? r.problems.join(" ") : `"${name}" updated and sent to Meta for review.` };
}

export async function addStarterTemplatesFromBuilder(): Promise<TemplatesResult> {
  const admin = await requireAdmin("bot");
  if (!can(admin, "messaging")) return { ok: false, templates: await listTemplates(admin.tenantId), message: NO_MESSAGING };
  const problems = await addStarterTemplates(admin.tenantId);
  await audit(admin, "templates.starters_added", "wa_templates", null, { from: "flow_builder" });
  return { ok: !problems.length, templates: await listTemplates(admin.tenantId), message: problems.length ? problems.join(" ") : "Starter templates added and sent to Meta for approval." };
}

export async function refreshTemplates(): Promise<TemplatesResult> {
  const admin = await requireAdmin("bot");
  let message: string | undefined;
  if (wabaConfigured()) {
    try {
      await syncTemplateStatuses(admin.tenantId);
    } catch (e) {
      message = e instanceof Error ? e.message : "Couldn't reach Meta.";
    }
  }
  return { ok: !message, templates: await listTemplates(admin.tenantId), message: message ?? "Status updated from Meta." };
}

// ---------------------------------------------------------------------------
// Media library (per series). WhatsApp: images JPG/PNG ≤ 5 MB, videos MP4 (H.264/AAC) ≤ 16 MB.
// ---------------------------------------------------------------------------

const ASSET_TYPES = {
  "image/jpeg": { kind: "image", ext: "jpg", max: 5 * 1048576 },
  "image/png": { kind: "image", ext: "png", max: 5 * 1048576 },
  "video/mp4": { kind: "video", ext: "mp4", max: 16 * 1048576 },
} as const;

/** Where an upload goes: one series' library, or (no series id) the label-wide library. */
async function libraryOf(tenantId: string, seriesId: string): Promise<{ seriesId: string | null; prefix: string }> {
  if (!seriesId) return { seriesId: null, prefix: "shared/library/" };
  if (!UUID.test(seriesId)) throw new Error("Series not found.");
  const { data: s } = await db().from("series").select("code").eq("tenant_id", tenantId).eq("id", seriesId).maybeSingle();
  if (!s) throw new Error("Series not found.");
  return { seriesId, prefix: `${s.code}/library/` };
}

export async function createAssetUpload(seriesId: string, mime: string, size: number): Promise<{ uploadUrl: string; path: string; publicUrl: string }> {
  const admin = await requireAdmin("bot");
  const type = ASSET_TYPES[mime as keyof typeof ASSET_TYPES];
  if (!type) throw new Error("WhatsApp accepts JPG or PNG images and MP4 videos.");
  if (size > type.max) throw new Error(`Too big for WhatsApp: ${type.kind === "video" ? "videos up to 16 MB" : "images up to 5 MB"}.`);
  const lib = await libraryOf(admin.tenantId, seriesId);
  const path = `${lib.prefix}${Date.now()}-${randomToken(6)}.${type.ext}`;
  const { data, error } = await db().storage.from("media").createSignedUploadUrl(path);
  if (error || !data) throw new Error(`Upload URL failed: ${error?.message}`);
  return { uploadUrl: data.signedUrl, path, publicUrl: db().storage.from("media").getPublicUrl(path).data.publicUrl };
}

export async function registerAsset(seriesId: string, a: { path: string; name: string; mime: string; size: number }): Promise<Asset> {
  const admin = await requireAdmin("bot");
  const type = ASSET_TYPES[a.mime as keyof typeof ASSET_TYPES];
  const lib = await libraryOf(admin.tenantId, seriesId);
  if (!type || !a.path.startsWith(lib.prefix) || a.path.includes("..")) throw new Error("Bad upload.");
  const url = db().storage.from("media").getPublicUrl(a.path).data.publicUrl;
  const { data, error } = await db()
    .from("media_assets")
    .insert({ tenant_id: admin.tenantId, series_id: lib.seriesId, kind: type.kind, name: a.name.slice(0, 120) || "Untitled", url, path: a.path, mime: a.mime, size_bytes: a.size, created_by: admin.id })
    .select("id, kind, name, url, size_bytes, created_at")
    .single();
  if (error || !data) throw new Error(`Couldn't save the file: ${error?.message}`);
  await audit(admin, "media.uploaded", lib.seriesId ? "series" : "media_library", lib.seriesId, { asset: data.id, kind: type.kind });
  return { id: data.id, kind: data.kind, name: data.name, url: data.url, sizeBytes: data.size_bytes, createdAt: data.created_at, shared: lib.seriesId === null };
}

/** Every saved canvas of the label (series drafts and versions, sequences, shared replies) that uses this file. */
async function assetUsedAnywhere(tenantId: string, assetId: string): Promise<string | null> {
  const has = (g: unknown) => assetIdsIn(sanitizeGraph(g)).has(assetId);
  const [{ data: flows }, { data: versions }, { data: seqs }, { data: shared }] = await Promise.all([
    db().from("flows").select("draft").eq("tenant_id", tenantId),
    db().from("flow_versions").select("graph").eq("tenant_id", tenantId),
    db().from("sequences").select("name, draft, graph").eq("tenant_id", tenantId),
    db().from("shared_flows").select("draft, graph").eq("tenant_id", tenantId).maybeSingle(),
  ]);
  if (shared && (has(shared.draft) || has(shared.graph))) return "Shared replies";
  const seq = (seqs ?? []).find((q) => has(q.draft) || has(q.graph));
  if (seq) return `the sequence "${seq.name}"`;
  if ((flows ?? []).some((f) => has(f.draft)) || (versions ?? []).some((v) => has(v.graph))) return "a series flow";
  return null;
}

export async function renameAsset(assetId: string, name: string): Promise<void> {
  const admin = await requireAdmin("bot");
  if (!UUID.test(assetId)) return;
  await db().from("media_assets").update({ name: name.slice(0, 120) || "Untitled" }).eq("tenant_id", admin.tenantId).eq("id", assetId);
}

export async function deleteAsset(seriesId: string, assetId: string, currentDraft: unknown): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireAdmin("bot");
  if (!UUID.test(assetId)) return { ok: true };
  if (assetIdsIn(sanitizeGraph(currentDraft)).has(assetId)) return { ok: false, error: "It's used on this canvas. Remove it from those cards first." };
  const used = await assetUsedAnywhere(admin.tenantId, assetId);
  if (used) return { ok: false, error: `It's used in ${used}. Remove it from those cards first.` };
  const { data: a } = await db().from("media_assets").select("path, series_id").eq("tenant_id", admin.tenantId).eq("id", assetId).maybeSingle();
  if (!a) return { ok: true };
  await db().storage.from("media").remove([a.path]);
  await db().from("media_assets").delete().eq("id", assetId);
  await audit(admin, "media.deleted", a.series_id ? "series" : "media_library", a.series_id ?? seriesId ?? null, { asset: assetId });
  return { ok: true };
}
