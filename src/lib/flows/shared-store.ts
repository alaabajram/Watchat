// Loads and saves the shared flow (Flow builder → Shared replies). Server only.

import { COPY, COPY_KEYS, isCopyKey, type CopyKey } from "../bot/copy";
import { getAiSettings } from "../ai/settings";
import { listTemplates } from "../messaging/template-store";
import { db } from "../supabase";
import { sanitizeGraph } from "./sanitize";
import { standardSharedFlow, type TextOf } from "./shared";
import { canvasRow, listMyCards, sharedAssets, type BuilderData } from "./store";
import { pickChannelFlow, type Bi, type FlowChannel, type FlowGraph, type ViewerChannel } from "./types";

/** The team's saved Shared reply texts (bot_messages without a series), over the built-in defaults. */
export async function sharedTexts(tenantId: string): Promise<TextOf> {
  const { data } = await db().from("bot_messages").select("key, lang, body").eq("tenant_id", tenantId).is("series_id", null);
  const saved = new Map<string, string>();
  for (const r of data ?? []) if (isCopyKey(r.key) && String(r.body ?? "").trim()) saved.set(`${r.key}.${r.lang}`, r.body as string);
  return (key: CopyKey): Bi => ({ ar: saved.get(`${key}.ar`) ?? COPY[key].ar, en: saved.get(`${key}.en`) ?? COPY[key].en });
}

/** What the bot runs: the published shared flow, or the standard one with the saved texts. */
export async function publishedSharedFlow(tenantId: string, viewer: ViewerChannel = "whatsapp"): Promise<FlowGraph> {
  // The viewer's own app's shared replies when there's a WhatsApp + Telegram pair, else the ones for both.
  const { data: rows } = await db().from("shared_flows").select("graph, channel").eq("tenant_id", tenantId);
  const data = pickChannelFlow((rows ?? []) as { graph: unknown; channel: FlowChannel }[], viewer);
  const g = data?.graph ? sanitizeGraph(data.graph) : null;
  return g ?? standardSharedFlow(await sharedTexts(tenantId));
}

export type SharedInfo = { seriesCodes: string[]; fixedTexts: CopyKey[]; saved: Record<string, string> };

/** Texts the bot still sends on its own (not on any shared card): edited in "Texts the bot sends by itself". */
export const FIXED_TEXT_KEYS: CopyKey[] = ["needSeriesFirst", "seriesNotFound", "notForMeBody", "btnSeeSeries", "seriesSectionTitle", "noOtherSeries", "picksBody", "pinHint"];

export async function loadSharedBuilder(tenantId: string, want: "telegram" | null = null): Promise<BuilderData & { shared: SharedInfo }> {
  const [{ data: rows }, templates, myCards, { data: series }, texts, { data: saved }, ai] = await Promise.all([
    db().from("shared_flows").select("draft, draft_updated_at, graph, version, published_at, channel").eq("tenant_id", tenantId),
    listTemplates(tenantId),
    listMyCards(tenantId),
    db().from("series").select("code, title_ar, title_en, poster_url, status").eq("tenant_id", tenantId).order("created_at"),
    sharedTexts(tenantId),
    db().from("bot_messages").select("key, lang, body").eq("tenant_id", tenantId).is("series_id", null),
    getAiSettings(tenantId),
  ]);
  type Row = { draft: unknown; draft_updated_at: string | null; graph: unknown; version: number; published_at: string | null; channel: FlowChannel };
  const all = (rows ?? []) as Row[];
  const split = all.some((r) => r.channel === "telegram");
  const row = canvasRow(all, want);
  const published = row?.graph ? sanitizeGraph(row.graph) : null;
  const draft = sanitizeGraph(row?.draft) ?? published ?? standardSharedFlow(texts);
  const live = (series ?? []).filter((s) => s.status === "live");
  const sample = live[0] ?? (series ?? [])[0];
  return {
    seriesId: "",
    code: "Shared replies",
    status: published ? "live" : "standard",
    series: {
      titleAr: sample?.title_ar ?? "أسرار",
      titleEn: sample?.title_en ?? "Secrets",
      episodeCount: 12,
      posterUrl: sample?.poster_url ?? null,
      trailerUrl: null,
      clips: {},
      others: live.map((s) => ({ code: s.code as string, titleAr: s.title_ar as string, titleEn: s.title_en as string })),
    },
    draft,
    draftUpdatedAt: (row?.draft_updated_at as string | null) ?? new Date(0).toISOString(),
    published: published ? { versionId: "shared", version: row?.version as number, graph: published } : null,
    versions: [],
    assets: await sharedAssets(tenantId),
    templates,
    aiReady: ai.connected && ai.enabled,
    myCards: myCards.filter((c) => c.block.nodes.every((n) => !["episode", "wait", "template", "start", "web", "trigger", "end"].includes(n.data.kind))),
    stats: {},
    channel: row?.channel ?? "both",
    split,
    shared: {
      seriesCodes: (series ?? []).map((s) => s.code as string),
      fixedTexts: FIXED_TEXT_KEYS,
      saved: Object.fromEntries((saved ?? []).filter((r) => isCopyKey(r.key) && COPY_KEYS.includes(r.key)).map((r) => [`${r.key}.${r.lang}`, r.body as string])),
    },
  };
}
