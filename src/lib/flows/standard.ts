// The standard flow (language → trailer → chat episodes → web link → alerts), built from a series'
// content and the current default texts, and auto-published the first time a series has a chat
// without a published flow. Server-only (uses the database).

import { COPY, COPY_KEYS, isCopyKey, type CopyKey } from "../bot/copy";
import { db } from "../supabase";
import { defaultFlow } from "./defaults";
import { sanitizeGraph } from "./sanitize";
import type { Bi, FlowGraph } from "./types";

export async function standardGraph(tenantId: string, seriesId: string): Promise<FlowGraph | null> {
  const { data: s } = await db()
    .from("series")
    .select("id, wa_episode_count, trailer_video_url, episodes(count)")
    .eq("tenant_id", tenantId)
    .eq("id", seriesId)
    .maybeSingle();
  if (!s) return null;
  const { data: rows } = await db()
    .from("bot_messages")
    .select("key, lang, body, series_id")
    .eq("tenant_id", tenantId)
    .or(`series_id.is.null,series_id.eq.${seriesId}`);
  const texts = Object.fromEntries(COPY_KEYS.map((k) => [k, { ar: COPY[k].ar, en: COPY[k].en }])) as Record<CopyKey, Bi>;
  for (const r of [...(rows ?? [])].sort((a, b) => (a.series_id ? 1 : 0) - (b.series_id ? 1 : 0))) {
    if (isCopyKey(r.key) && (r.lang === "ar" || r.lang === "en") && r.body.trim()) texts[r.key][r.lang as "ar" | "en"] = r.body;
  }
  const episodeCount = (s.episodes as { count: number }[] | null)?.[0]?.count ?? 0;
  return defaultFlow({
    askLanguage: true,
    sendTrailer: true,
    hasTrailer: Boolean(s.trailer_video_url),
    askOptIn: true,
    waEpisodeCount: s.wa_episode_count,
    episodeCount,
    texts,
  });
}

/** The series' live flow. If none was ever published, publish the standard flow as the next version. */
export async function ensurePublishedFlow(tenantId: string, seriesId: string): Promise<{ versionId: string; graph: FlowGraph } | null> {
  const live = async () => {
    const { data: f } = await db().from("flows").select("id, published_version_id").eq("series_id", seriesId).maybeSingle();
    if (!f?.published_version_id) return { flowId: f?.id ?? null, live: null };
    const { data: v } = await db().from("flow_versions").select("graph").eq("id", f.published_version_id).maybeSingle();
    const graph = sanitizeGraph(v?.graph);
    return { flowId: f.id as string, live: graph ? { versionId: f.published_version_id as string, graph } : null };
  };

  const first = await live();
  if (first.live) return first.live;

  const graph = await standardGraph(tenantId, seriesId);
  if (!graph) return null;
  let flowId = first.flowId;
  if (!flowId) {
    const { data, error } = await db().from("flows").insert({ tenant_id: tenantId, series_id: seriesId, draft: graph }).select("id").single();
    if (error) return (await live()).live; // created at the same moment by another chat
    flowId = data.id;
  }
  const { data: last } = await db().from("flow_versions").select("version").eq("flow_id", flowId).order("version", { ascending: false }).limit(1).maybeSingle();
  const { data: v, error } = await db()
    .from("flow_versions")
    .insert({ tenant_id: tenantId, flow_id: flowId, version: (last?.version ?? 0) + 1, graph, note: "Standard flow (published automatically)" })
    .select("id")
    .single();
  if (error || !v) return (await live()).live;
  const { data: claimed } = await db().from("flows").update({ published_version_id: v.id }).eq("id", flowId).is("published_version_id", null).select("id");
  if (!claimed?.length) return (await live()).live; // another chat published first: use theirs
  return { versionId: v.id, graph };
}
