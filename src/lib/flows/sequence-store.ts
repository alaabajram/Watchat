// Loads a sequence flow for the builder, and the starter canvas a new sequence opens with.

import { getAiSettings } from "../ai/settings";
import { listTemplates } from "../messaging/template-store";
import { db } from "../supabase";
import { newId } from "./defaults";
import { sanitizeGraph } from "./sanitize";
import { listMyCards, sharedAssets, type BuilderData } from "./store";
import type { FlowGraph , FlowChannel } from "./types";

export type SequenceInfo = { id: string; name: string; active: boolean; seriesCodes: string[]; running: number; waiting: number; channel: FlowChannel };

/** A useful first sequence: reminder → wait 2 days → came back? → end, or a last-chance template. */
export function starterSequence(): FlowGraph {
  const [t, a, w, c, e1, b, e2] = Array.from({ length: 7 }, () => newId());
  const at = (x: number, y: number) => ({ x, y });
  return {
    v: 1,
    nodes: [
      { id: t, position: at(0, 0), data: { kind: "trigger", trigger: "stopped_mid_series", delayHours: 24, seriesCode: null } },
      { id: a, position: at(0, 200), data: { kind: "template", name: "" }, name: "Day 1 reminder" },
      { id: w, position: at(0, 400), data: { kind: "wait", minutes: 2 * 1440 } },
      { id: c, position: at(0, 580), data: { kind: "condition", condition: { check: "came_back" } } },
      { id: e1, position: at(-260, 780), data: { kind: "end" }, name: "They're back" },
      { id: b, position: at(200, 780), data: { kind: "template", name: "" }, name: "Last-chance offer" },
      { id: e2, position: at(200, 980), data: { kind: "end" } },
    ],
    edges: [
      { id: newId(), source: t, sourceHandle: "next", target: a },
      { id: newId(), source: a, sourceHandle: "next", target: w },
      { id: newId(), source: w, sourceHandle: "next", target: c },
      { id: newId(), source: c, sourceHandle: "yes", target: e1 },
      { id: newId(), source: c, sourceHandle: "no", target: b },
      { id: newId(), source: b, sourceHandle: "next", target: e2 },
    ],
  };
}

export async function loadSequenceBuilder(tenantId: string, id: string): Promise<(BuilderData & { sequence: SequenceInfo }) | null> {
  const { data: s } = await db()
    .from("sequences")
    .select("id, name, active, draft, graph, version, published_at, created_at, updated_at, channel")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (!s) return null;
  const [templates, myCards, { data: series }, { data: runs }, ai] = await Promise.all([
    listTemplates(tenantId),
    listMyCards(tenantId),
    db().from("series").select("code, title_ar, title_en, poster_url, status").eq("tenant_id", tenantId).order("created_at"),
    db().from("sequence_runs").select("status").eq("sequence_id", id).in("status", ["wait", "running"]),
    getAiSettings(tenantId),
  ]);
  const sample = (series ?? []).find((x) => x.status === "live") ?? (series ?? [])[0];
  const draft = sanitizeGraph(s.draft) ?? sanitizeGraph(s.graph) ?? starterSequence();
  const published = s.graph ? sanitizeGraph(s.graph) : null;
  return {
    seriesId: "",
    code: s.name as string,
    status: s.active ? "live" : "paused",
    // Template previews fill {title} with a sample series.
    series: {
      titleAr: sample?.title_ar ?? "مسلسل",
      titleEn: sample?.title_en ?? "Series",
      episodeCount: 0,
      posterUrl: sample?.poster_url ?? null,
      trailerUrl: null,
      clips: {},
      others: [],
    },
    draft,
    draftUpdatedAt: (s.updated_at ?? s.created_at) as string,
    published: published ? { versionId: s.id as string, version: s.version as number, graph: published } : null,
    versions: [],
    assets: await sharedAssets(tenantId),
    templates,
    aiReady: ai.connected && ai.enabled,
    myCards: myCards.filter((c) => c.block.nodes.every((n) => ["wait", "condition", "template", "end"].includes(n.data.kind))),
    stats: {},
    sequence: {
      id: s.id as string,
      name: s.name as string,
      active: Boolean(s.active),
      seriesCodes: (series ?? []).map((x) => x.code as string),
      channel: ((s as { channel?: FlowChannel }).channel ?? "both") as FlowChannel,
      running: (runs ?? []).filter((r) => r.status === "running").length,
      waiting: (runs ?? []).filter((r) => r.status === "wait").length,
    },
  };
}
