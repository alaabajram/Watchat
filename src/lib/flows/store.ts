// Loads everything the flow builder page needs, creating the series' draft from the standard
// scenario the first time it's opened.

import { getAiSettings } from "../ai/settings";
import { db } from "../supabase";
import type { PreviewSeries } from "./preview";
import { sanitizeGraph } from "./sanitize";
import { standardGraph } from "./standard";
import type { FlowGraph } from "./types";

export type Asset = { id: string; kind: "image" | "video"; name: string; url: string; sizeBytes: number | null; createdAt: string };
export type VersionInfo = { id: string; version: number; publishedAt: string; note: string | null };
export type TemplateInfo = { name: string; approved: boolean; status: string; bodyAr: string | null };

export type BuilderData = {
  seriesId: string;
  code: string;
  status: string;
  series: PreviewSeries;
  draft: FlowGraph;
  draftUpdatedAt: string;
  published: { versionId: string; version: number; graph: FlowGraph } | null;
  versions: VersionInfo[];
  assets: Asset[];
  templates: TemplateInfo[];
  aiReady: boolean;
};

export { standardGraph as standardFlowFor };

export async function loadBuilder(tenantId: string, seriesId: string, adminId: string): Promise<BuilderData | null> {
  const { data: s } = await db()
    .from("series")
    .select("id, code, status, title_ar, title_en, poster_url, trailer_video_url, episodes(number, wa_video_url_ar, wa_video_url_en)")
    .eq("tenant_id", tenantId)
    .eq("id", seriesId)
    .maybeSingle();
  if (!s) return null;

  let { data: flow } = await db().from("flows").select("id, draft, draft_updated_at, published_version_id").eq("series_id", seriesId).maybeSingle();
  if (!flow) {
    const draft = await standardGraph(tenantId, seriesId);
    const { data: created, error } = await db()
      .from("flows")
      .insert({ tenant_id: tenantId, series_id: seriesId, draft, draft_updated_by: adminId })
      .select("id, draft, draft_updated_at, published_version_id")
      .single();
    if (error) throw new Error(`Couldn't create the flow: ${error.message}`);
    flow = created;
  }

  const [{ data: versions }, { data: assets }, { data: templates }, ai] = await Promise.all([
    db().from("flow_versions").select("id, version, published_at, note, graph").eq("flow_id", flow!.id).order("version", { ascending: false }).limit(30),
    db().from("media_assets").select("id, kind, name, url, size_bytes, created_at").eq("tenant_id", tenantId).eq("series_id", seriesId).order("created_at", { ascending: false }),
    db().from("wa_templates").select("name, lang, meta_status, body").eq("tenant_id", tenantId).order("name"),
    getAiSettings(tenantId),
  ]);

  const byName = new Map<string, TemplateInfo>();
  for (const t of templates ?? []) {
    const cur = byName.get(t.name) ?? { name: t.name, approved: false, status: t.meta_status, bodyAr: null };
    if (t.meta_status === "APPROVED") cur.approved = true;
    if (t.lang === "ar") cur.bodyAr = t.body;
    cur.status = cur.approved ? "APPROVED" : t.meta_status;
    byName.set(t.name, cur);
  }
  const pub = (versions ?? []).find((v) => v.id === flow!.published_version_id);
  const eps = (s.episodes ?? []) as { number: number; wa_video_url_ar: string | null; wa_video_url_en: string | null }[];

  return {
    seriesId,
    code: s.code,
    status: s.status,
    series: {
      titleAr: s.title_ar,
      titleEn: s.title_en,
      episodeCount: eps.length,
      posterUrl: s.poster_url,
      trailerUrl: s.trailer_video_url,
      clips: Object.fromEntries(eps.map((e) => [e.number, { ar: e.wa_video_url_ar, en: e.wa_video_url_en }])),
    },
    draft: sanitizeGraph(flow!.draft) ?? { v: 1, nodes: [], edges: [] },
    draftUpdatedAt: flow!.draft_updated_at,
    published: pub ? { versionId: pub.id, version: pub.version, graph: sanitizeGraph(pub.graph) ?? { v: 1, nodes: [], edges: [] } } : null,
    versions: (versions ?? []).map((v) => ({ id: v.id, version: v.version, publishedAt: v.published_at, note: v.note })),
    assets: (assets ?? []).map((a) => ({ id: a.id, kind: a.kind, name: a.name, url: a.url, sizeBytes: a.size_bytes, createdAt: a.created_at })),
    templates: [...byName.values()],
    aiReady: ai.connected && ai.enabled,
  };
}
