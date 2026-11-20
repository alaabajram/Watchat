// Loads everything the flow builder page needs, creating the series' draft from the standard
// scenario the first time it's opened.

import { getAiSettings } from "../ai/settings";
import { listTemplates, type TemplateInfo } from "../messaging/template-store";
import { db } from "../supabase";
import type { PreviewSeries } from "./preview";
import { sanitizeGraph } from "./sanitize";
import { standardGraph } from "./standard";
import type { FlowGraph } from "./types";

export type { TemplateInfo };
export type Asset = { id: string; kind: "image" | "video"; name: string; url: string; sizeBytes: number | null; createdAt: string };
export type SavedCard = { id: string; name: string; cardCount: number; block: FlowGraph };
export type VersionInfo = { id: string; version: number; publishedAt: string; note: string | null };


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
  myCards: SavedCard[];
};

export async function listMyCards(tenantId: string): Promise<SavedCard[]> {
  const { data } = await db().from("saved_cards").select("id, name, card_count, block").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(200);
  return (data ?? [])
    .map((r) => ({ id: r.id as string, name: r.name as string, cardCount: r.card_count as number, block: sanitizeGraph(r.block) }))
    .filter((c): c is SavedCard => Boolean(c.block));
}

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

  const [{ data: versions }, { data: assets }, templates, ai, myCards] = await Promise.all([
    db().from("flow_versions").select("id, version, published_at, note, graph").eq("flow_id", flow!.id).order("version", { ascending: false }).limit(30),
    db().from("media_assets").select("id, kind, name, url, size_bytes, created_at").eq("tenant_id", tenantId).eq("series_id", seriesId).order("created_at", { ascending: false }),
    listTemplates(tenantId),
    getAiSettings(tenantId),
    listMyCards(tenantId),
  ]);

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
    templates,
    aiReady: ai.connected && ai.enabled,
    myCards,
  };
}
