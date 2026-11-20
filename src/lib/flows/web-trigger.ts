// "On the web" entry: when a viewer starts watching a series on the web, that series becomes their
// active one (other series' waiting follow-ups pause) and, if its flow has an "On the web" card, the
// flow runs from there. Fires at most once every 6 hours per viewer and series. Server-only.

import { createSupabaseDeps, primeViewer } from "../bot/deps-supabase";
import { flowEnvFor, saveRunResult, type ViewerLang } from "../bot/flow";
import { currentTenantId, db } from "../supabase";
import { hasWebEntry, startFlow } from "./engine";
import { ensurePublishedFlow } from "./standard";

export const WEB_TRIGGER_HOURS = 6;
const WINDOW_MS = 24 * 3600 * 1000;
const recent = new Map<string, number>(); // per server instance: skip the database for 10 minutes after a check

export async function onWebWatch(viewerId: string, seriesId: string, now = new Date()): Promise<"skipped" | "paused_others" | "started"> {
  const key = `${viewerId}:${seriesId}`;
  if ((recent.get(key) ?? 0) > now.getTime() - 10 * 60_000) return "skipped";
  recent.set(key, now.getTime());

  const tenantId = await currentTenantId();
  const cutoff = new Date(now.getTime() - WEB_TRIGGER_HOURS * 3600_000).toISOString();
  const deps = createSupabaseDeps();
  const existing = await deps.getFlowRun(viewerId, seriesId);
  if (existing?.webTriggeredAt && existing.webTriggeredAt > cutoff) return "skipped";

  const flow = await ensurePublishedFlow(tenantId, seriesId);
  if (!flow) return "skipped";

  // Claim this trigger so parallel heartbeats can't fire it twice.
  if (existing) {
    const { data } = await db()
      .from("flow_runs")
      .update({ web_triggered_at: now.toISOString() })
      .eq("viewer_id", viewerId)
      .eq("series_id", seriesId)
      .or(`web_triggered_at.is.null,web_triggered_at.lt.${cutoff}`)
      .select("viewer_id");
    if (!data?.length) return "skipped";
  } else {
    const { error } = await db().from("flow_runs").insert({
      viewer_id: viewerId,
      tenant_id: tenantId,
      series_id: seriesId,
      version_id: flow.versionId,
      node_id: "",
      status: "done",
      entry: "web",
      web_triggered_at: now.toISOString(),
    });
    if (error) return "skipped";
  }

  await deps.pauseOtherRuns(viewerId, seriesId);
  if (!hasWebEntry(flow.graph)) return "paused_others";

  const [{ data: v }, series] = await Promise.all([
    db().from("viewers").select("id, phone_e164, language, last_inbound_at").eq("id", viewerId).maybeSingle(),
    deps.getSeries(seriesId),
  ]);
  if (!v || !series) return "paused_others";
  const waId = String(v.phone_e164).replace(/^\+/, "");
  primeViewer(v.id, waId);
  const viewer = { id: v.id as string, waId, language: v.language as ViewerLang | null };
  const lastInbound = v.last_inbound_at ? Date.parse(v.last_inbound_at) : 0;
  const run = { chatEpisode: existing?.chatEpisode ?? 0 };
  const env = flowEnvFor(viewer, series, deps, { canSendFreeform: now.getTime() - lastInbound < WINDOW_MS, now: () => now.getTime(), run });
  const result = await startFlow(flow.graph, env, "web");
  await saveRunResult(deps, viewer, seriesId, flow.versionId, result, { entry: "web", chatEpisode: run.chatEpisode, webTriggeredAt: now.toISOString() });
  return "started";
}
