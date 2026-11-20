"use server";

// Flow builder actions: save draft, publish (after checks), versions, and the series media library.

import { audit, requireAdmin } from "@/lib/admin/auth";
import { randomToken } from "@/lib/crypto";
import { assetIdsIn, sanitizeGraph } from "@/lib/flows/sanitize";
import { standardFlowFor, type Asset } from "@/lib/flows/store";
import type { FlowGraph } from "@/lib/flows/types";
import { hasErrors, validateFlow, type Issue } from "@/lib/flows/validate";
import { db } from "@/lib/supabase";

const UUID = /^[0-9a-f-]{36}$/;

async function flowFor(tenantId: string, seriesId: string) {
  if (!UUID.test(seriesId)) throw new Error("Bad series id");
  const { data } = await db().from("flows").select("id, published_version_id, draft").eq("tenant_id", tenantId).eq("series_id", seriesId).maybeSingle();
  if (!data) throw new Error("Open the flow builder for this series first.");
  return data;
}

async function checkCtx(tenantId: string, seriesId: string) {
  const [{ count }, { data: templates }] = await Promise.all([
    db().from("episodes").select("id", { count: "exact", head: true }).eq("series_id", seriesId),
    db().from("wa_templates").select("name, meta_status").eq("tenant_id", tenantId),
  ]);
  const names = new Map<string, boolean>();
  for (const t of templates ?? []) names.set(t.name, (names.get(t.name) ?? false) || t.meta_status === "APPROVED");
  return { episodeCount: count ?? 0, templates: [...names].map(([name, approved]) => ({ name, approved })) };
}

export async function saveFlowDraft(seriesId: string, graph: unknown): Promise<{ ok: true; savedAt: string } | { ok: false; error: string }> {
  const admin = await requireAdmin("bot");
  const clean = sanitizeGraph(graph);
  if (!clean) return { ok: false, error: "The flow is too big or malformed." };
  const flow = await flowFor(admin.tenantId, seriesId);
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
): Promise<{ ok: true; version: number; versionId: string; issues: Issue[] } | { ok: false; issues: Issue[]; error?: string }> {
  const admin = await requireAdmin("bot");
  const clean = sanitizeGraph(graph);
  if (!clean) return { ok: false, issues: [], error: "The flow is too big or malformed." };
  const issues = validateFlow(clean, await checkCtx(admin.tenantId, seriesId));
  if (hasErrors(issues)) return { ok: false, issues };

  const flow = await flowFor(admin.tenantId, seriesId);
  const { data: last } = await db().from("flow_versions").select("version").eq("flow_id", flow.id).order("version", { ascending: false }).limit(1).maybeSingle();
  const version = (last?.version ?? 0) + 1;
  const { data: v, error } = await db()
    .from("flow_versions")
    .insert({ tenant_id: admin.tenantId, flow_id: flow.id, version, graph: clean, note: note.slice(0, 300) || null, published_by: admin.id })
    .select("id")
    .single();
  if (error || !v) return { ok: false, issues, error: error?.message ?? "Publish failed" };
  await db().from("flows").update({ draft: clean, draft_updated_at: new Date().toISOString(), draft_updated_by: admin.id, published_version_id: v.id }).eq("id", flow.id);
  await audit(admin, "flow.published", "series", seriesId, { version, cards: clean.nodes.length });
  return { ok: true, version, versionId: v.id, issues };
}

export async function unpublishFlow(seriesId: string): Promise<void> {
  const admin = await requireAdmin("bot");
  const flow = await flowFor(admin.tenantId, seriesId);
  await db().from("flows").update({ published_version_id: null }).eq("id", flow.id);
  await audit(admin, "flow.unpublished", "series", seriesId);
}

export async function loadVersion(seriesId: string, versionId: string): Promise<FlowGraph | null> {
  const admin = await requireAdmin("bot");
  const flow = await flowFor(admin.tenantId, seriesId);
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
// Media library (per series). WhatsApp: images JPG/PNG ≤ 5 MB, videos MP4 (H.264/AAC) ≤ 16 MB.
// ---------------------------------------------------------------------------

const ASSET_TYPES = {
  "image/jpeg": { kind: "image", ext: "jpg", max: 5 * 1048576 },
  "image/png": { kind: "image", ext: "png", max: 5 * 1048576 },
  "video/mp4": { kind: "video", ext: "mp4", max: 16 * 1048576 },
} as const;

export async function createAssetUpload(seriesId: string, mime: string, size: number): Promise<{ uploadUrl: string; path: string; publicUrl: string }> {
  const admin = await requireAdmin("bot");
  const type = ASSET_TYPES[mime as keyof typeof ASSET_TYPES];
  if (!type) throw new Error("WhatsApp accepts JPG or PNG images and MP4 videos.");
  if (size > type.max) throw new Error(`Too big for WhatsApp: ${type.kind === "video" ? "videos up to 16 MB" : "images up to 5 MB"}.`);
  const { data: s } = await db().from("series").select("code").eq("tenant_id", admin.tenantId).eq("id", seriesId).maybeSingle();
  if (!s) throw new Error("Series not found.");
  const path = `${s.code}/library/${Date.now()}-${randomToken(6)}.${type.ext}`;
  const { data, error } = await db().storage.from("media").createSignedUploadUrl(path);
  if (error || !data) throw new Error(`Upload URL failed: ${error?.message}`);
  return { uploadUrl: data.signedUrl, path, publicUrl: db().storage.from("media").getPublicUrl(path).data.publicUrl };
}

export async function registerAsset(seriesId: string, a: { path: string; name: string; mime: string; size: number }): Promise<Asset> {
  const admin = await requireAdmin("bot");
  const type = ASSET_TYPES[a.mime as keyof typeof ASSET_TYPES];
  const { data: s } = await db().from("series").select("code").eq("tenant_id", admin.tenantId).eq("id", seriesId).maybeSingle();
  if (!type || !s || !a.path.startsWith(`${s.code}/library/`) || a.path.includes("..")) throw new Error("Bad upload.");
  const url = db().storage.from("media").getPublicUrl(a.path).data.publicUrl;
  const { data, error } = await db()
    .from("media_assets")
    .insert({ tenant_id: admin.tenantId, series_id: seriesId, kind: type.kind, name: a.name.slice(0, 120) || "Untitled", url, path: a.path, mime: a.mime, size_bytes: a.size, created_by: admin.id })
    .select("id, kind, name, url, size_bytes, created_at")
    .single();
  if (error || !data) throw new Error(`Couldn't save the file: ${error?.message}`);
  await audit(admin, "media.uploaded", "series", seriesId, { asset: data.id, kind: type.kind });
  return { id: data.id, kind: data.kind, name: data.name, url: data.url, sizeBytes: data.size_bytes, createdAt: data.created_at };
}

export async function renameAsset(assetId: string, name: string): Promise<void> {
  const admin = await requireAdmin("bot");
  if (!UUID.test(assetId)) return;
  await db().from("media_assets").update({ name: name.slice(0, 120) || "Untitled" }).eq("tenant_id", admin.tenantId).eq("id", assetId);
}

export async function deleteAsset(seriesId: string, assetId: string, currentDraft: unknown): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireAdmin("bot");
  const flow = await flowFor(admin.tenantId, seriesId);
  const inDraft = assetIdsIn(sanitizeGraph(currentDraft)).has(assetId) || assetIdsIn(sanitizeGraph(flow.draft)).has(assetId);
  let inPublished = false;
  if (flow.published_version_id) {
    const { data } = await db().from("flow_versions").select("graph").eq("id", flow.published_version_id).maybeSingle();
    inPublished = assetIdsIn(sanitizeGraph(data?.graph)).has(assetId);
  }
  if (inDraft || inPublished) return { ok: false, error: `It's used in the ${inPublished ? "published flow" : "draft"}. Remove it from those cards first.` };
  const { data: a } = await db().from("media_assets").select("path").eq("tenant_id", admin.tenantId).eq("id", assetId).maybeSingle();
  if (!a) return { ok: true };
  await db().storage.from("media").remove([a.path]);
  await db().from("media_assets").delete().eq("id", assetId);
  await audit(admin, "media.deleted", "series", seriesId, { asset: assetId });
  return { ok: true };
}
