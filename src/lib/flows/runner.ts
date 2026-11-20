// Continues flows whose Wait card is due. Called by the messaging cron every 15 minutes.
// Rules: nothing during quiet hours (22:00–09:00 Gulf time; runs stay due and go out after),
// each run is claimed (status wait → running) before anything is sent so overlapping runs can't
// double-send, and free-form cards are only sent within 24 h of the viewer's last WhatsApp message.

import { createSupabaseDeps, primeViewer } from "../bot/deps-supabase";
import { flowEnvFor, saveRunResult, type ViewerLang } from "../bot/flow";
import { isQuietHours } from "../messaging/policy";
import { db } from "../supabase";
import { resumeAfterWait } from "./engine";

const MAX_PER_RUN = 200;
const WINDOW_MS = 24 * 3600 * 1000;

export type FlowRunSummary = { due: number; resumed: number; blocked: number; failed: number; quietHours: boolean };

export async function runFlowWaits(now = new Date()): Promise<FlowRunSummary> {
  const summary: FlowRunSummary = { due: 0, resumed: 0, blocked: 0, failed: 0, quietHours: isQuietHours(now) };
  if (summary.quietHours) return summary;

  const { data: due } = await db()
    .from("flow_runs")
    .select("viewer_id, series_id, version_id, node_id")
    .eq("status", "wait")
    .lte("resume_at", now.toISOString())
    .order("resume_at")
    .limit(MAX_PER_RUN);
  summary.due = due?.length ?? 0;
  const deps = createSupabaseDeps();

  for (const run of due ?? []) {
    // Claim it first.
    const { data: claimed } = await db()
      .from("flow_runs")
      .update({ status: "running", updated_at: new Date().toISOString() })
      .eq("viewer_id", run.viewer_id)
      .eq("status", "wait")
      .eq("node_id", run.node_id)
      .select("viewer_id");
    if (!claimed?.length) continue;

    try {
      const [{ data: v }, series, graph] = await Promise.all([
        db().from("viewers").select("id, phone_e164, language, last_inbound_at").eq("id", run.viewer_id).maybeSingle(),
        deps.getSeries(run.series_id),
        deps.getFlowVersion(run.version_id),
      ]);
      if (!v || !series || !graph) throw new Error("viewer, series or flow version missing");
      const waId = String(v.phone_e164).replace(/^\+/, "");
      primeViewer(v.id, waId);
      const viewer = { id: v.id as string, waId, language: v.language as ViewerLang | null };
      const lastInbound = v.last_inbound_at ? Date.parse(v.last_inbound_at) : 0;
      const env = flowEnvFor(viewer, series, deps, { canSendFreeform: now.getTime() - lastInbound < WINDOW_MS, now: () => now.getTime() });
      const result = await resumeAfterWait(graph, run.node_id, env);
      await saveRunResult(deps, viewer, run.series_id, run.version_id, result);
      if (result.status === "blocked") summary.blocked++;
      else summary.resumed++;
    } catch (e) {
      summary.failed++;
      console.error("[flows] resume failed", { viewer: run.viewer_id, err: e instanceof Error ? e.message : e });
      await db().from("flow_runs").update({ status: "blocked", updated_at: new Date().toISOString() }).eq("viewer_id", run.viewer_id);
    }
  }
  return summary;
}
