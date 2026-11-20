// The growth agent's daily run, sending approved suggestions, and its settings. Server-only.
// Suggest mode: suggestions wait in Admin → Growth agent for the team. Autopilot (once earned) sends them.
// Every send goes through the same rules as campaigns: alerts on, approved templates, quiet hours,
// one marketing message per 20 hours.

import { AiError, callTool } from "../ai/anthropic";
import { aiAccount, logAiUsage } from "../ai/settings";
import { sha256Hex } from "../crypto";
import { isQuietHours } from "../messaging/policy";
import { sendNamedTemplateDetailed } from "../messaging/runner";
import { db } from "../supabase";
import { GROWTH_TOOL, autopilotReadiness, growthSystemPrompt, validateDecisions, viewersMessage, type ViewerSummary } from "./agent";
import { buildSummaries, loadCatalog, loadLearning, refreshOutcomes } from "./timeline";

export type GrowthSettings = {
  enabled: boolean;
  mode: "suggest" | "autopilot";
  dailyLimit: number;
  minInactiveDays: number;
  holdoutPct: number;
  runHour: number;
  lastRunAt: string | null;
};

const DEFAULTS: GrowthSettings = { enabled: false, mode: "suggest", dailyLimit: 50, minInactiveDays: 2, holdoutPct: 10, runHour: 11, lastRunAt: null };
const BATCH = 10;
const MAX_INACTIVE_DAYS = 30;

export async function getGrowthSettings(tenantId: string): Promise<GrowthSettings> {
  const { data } = await db().from("growth_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
  if (!data) return DEFAULTS;
  return {
    enabled: data.enabled,
    mode: data.mode,
    dailyLimit: data.daily_limit,
    minInactiveDays: data.min_inactive_days,
    holdoutPct: data.holdout_pct,
    runHour: data.run_hour,
    lastRunAt: data.last_run_at,
  };
}

/** Same viewer always lands in the same group, so the comparison stays fair. */
export function inHoldout(viewerId: string, pct: number): boolean {
  return parseInt(sha256Hex(`holdout:${viewerId}`).slice(0, 4), 16) % 100 < pct;
}

export async function reviewStats(tenantId: string): Promise<{ reviewed: number; approved: number }> {
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const { data } = await db().from("growth_suggestions").select("status").eq("tenant_id", tenantId).not("decided_by", "is", null).gte("decided_at", since);
  const reviewed = data?.length ?? 0;
  return { reviewed, approved: (data ?? []).filter((d) => d.status !== "rejected").length };
}

export type RunSummary = { reviewed: number; holdout: number; suggestions: number; none: number; sent: number; error?: string };

export async function runGrowth(tenantId: string, opts: { force?: boolean; adminId?: string | null } = {}): Promise<RunSummary> {
  const summary: RunSummary = { reviewed: 0, holdout: 0, suggestions: 0, none: 0, sent: 0 };
  const settings = await getGrowthSettings(tenantId);
  if (!settings.enabled && !opts.force) return { ...summary, error: "The growth agent is switched off." };
  const account = await aiAccount(tenantId);
  if (!account.ok) return { ...summary, error: account.reason };

  // Housekeeping: old pending suggestions expire; record who came back.
  await db().from("growth_suggestions").update({ status: "expired" }).eq("tenant_id", tenantId).eq("status", "pending").lt("created_at", new Date(Date.now() - 72 * 3600_000).toISOString());
  await refreshOutcomes(tenantId);

  const { data: candidates, error } = await db().rpc("growth_candidates", { p_tenant: tenantId, p_min_days: settings.minInactiveDays, p_max_days: MAX_INACTIVE_DAYS, p_limit: settings.dailyLimit });
  if (error) return { ...summary, error: error.message };
  const ids = ((candidates ?? []) as { viewer_id: string }[]).map((c) => c.viewer_id);
  summary.reviewed = ids.length;
  const runId = crypto.randomUUID();

  const holdout = ids.filter((id) => inHoldout(id, settings.holdoutPct));
  if (holdout.length) {
    await db().from("growth_suggestions").insert(holdout.map((viewer_id) => ({ tenant_id: tenantId, viewer_id, run_id: runId, status: "holdout", action: "none", reason: "Holdout group: no messages, for comparison." })));
    summary.holdout = holdout.length;
  }
  const review = ids.filter((id) => !holdout.includes(id));
  if (!review.length) {
    await db().from("growth_settings").upsert({ tenant_id: tenantId, last_run_at: new Date().toISOString() }, { onConflict: "tenant_id" });
    return summary;
  }

  const [catalog, learning, summaries] = await Promise.all([loadCatalog(tenantId), loadLearning(tenantId), buildSummaries(tenantId, review)]);
  const system = growthSystemPrompt(catalog, learning);
  const { data: seriesRows } = await db().from("series").select("id, code").eq("tenant_id", tenantId);
  const seriesId = new Map((seriesRows ?? []).map((s) => [s.code as string, s.id as string]));
  const created: string[] = [];

  for (let i = 0; i < review.length; i += BATCH) {
    const batch = review.slice(i, i + BATCH).filter((id) => summaries.has(id));
    const viewers: ViewerSummary[] = batch.map((id, k) => ({ ref: `v${k + 1}`, ...summaries.get(id)! }));
    try {
      const r = await callTool({ apiKey: account.apiKey, model: account.model, system, turns: [{ role: "user", content: viewersMessage(viewers) }], tool: GROWTH_TOOL, maxTokens: 8000 });
      await logAiUsage({ tenantId, adminId: opts.adminId ?? null, purpose: "growth_run", model: account.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, ok: true });
      const decisions = validateDecisions(r.input, viewers, catalog);
      const rows = decisions.map((d) => {
        const viewerId = batch[Number(d.ref.slice(1)) - 1];
        return {
          tenant_id: tenantId,
          viewer_id: viewerId,
          run_id: runId,
          status: d.action === "none" ? "skipped" : "pending",
          action: d.action,
          series_id: d.series ? (seriesId.get(d.series) ?? null) : null,
          episode: d.episode || null,
          template_name: d.template || null,
          options: d.picks.length ? d.picks : null,
          reason: d.reason,
          priority: d.priority,
          snapshot: viewers.find((v) => v.ref === d.ref) ?? {},
        };
      });
      const { data: inserted } = await db().from("growth_suggestions").insert(rows).select("id, status, action");
      for (const row of inserted ?? []) if (row.status === "pending" && row.action !== "flag") created.push(row.id);
      summary.suggestions += rows.filter((r) => r.status === "pending").length;
      summary.none += rows.filter((r) => r.status === "skipped").length;
    } catch (e) {
      const message = e instanceof AiError ? e.message : "AI request failed.";
      await logAiUsage({ tenantId, adminId: opts.adminId ?? null, purpose: "growth_run", model: account.model, ok: false, error: message });
      summary.error = message;
      break;
    }
  }

  await db().from("growth_settings").upsert({ tenant_id: tenantId, last_run_at: new Date().toISOString() }, { onConflict: "tenant_id" });

  // Autopilot only once earned; flags always wait for the team.
  if (settings.mode === "autopilot") {
    const s = await reviewStats(tenantId);
    if (autopilotReadiness(s.reviewed, s.approved).ready) {
      for (const id of created) if ((await executeSuggestion(tenantId, id, null)).ok) summary.sent++;
    }
  }
  return summary;
}

/** Send one pending suggestion (approved by the team, or by autopilot). */
export async function executeSuggestion(tenantId: string, id: string, adminId: string | null): Promise<{ ok: boolean; message: string }> {
  const { data: g } = await db()
    .from("growth_suggestions")
    .select("id, viewer_id, status, action, series_id, episode, template_name")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (!g || g.status !== "pending") return { ok: false, message: "This suggestion was already handled." };
  if (g.action !== "template" && g.action !== "series_picks") return { ok: false, message: "Nothing to send for this suggestion." };
  if (isQuietHours()) return { ok: false, message: "Quiet hours (22:00–09:00 Gulf time). Approve again after 9:00." };

  const [{ data: v }, { data: opt }] = await Promise.all([
    db().from("viewers").select("id, phone_e164, language").eq("id", g.viewer_id).maybeSingle(),
    db().from("opt_ins").select("status").eq("viewer_id", g.viewer_id).eq("topic", "new_episodes").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const finish = async (status: "sent" | "failed", error: string | null) => {
    await db()
      .from("growth_suggestions")
      .update({ status, error, decided_by: adminId, decided_at: new Date().toISOString(), ...(status === "sent" ? { sent_at: new Date().toISOString() } : {}) })
      .eq("id", id);
  };
  if (!v) return (await finish("failed", "viewer not found"), { ok: false, message: "Viewer not found." });
  if (opt?.status !== "in") return (await finish("failed", "alerts are off"), { ok: false, message: "The viewer turned alerts off; not sent." });

  const r = await sendNamedTemplateDetailed(
    { viewerId: v.id, phone: v.phone_e164, language: v.language, seriesId: g.series_id, episode: g.episode },
    g.template_name!,
    { source: "growth", ref: { type: "growth", id }, ...(g.action === "series_picks" ? { quickReplyPayload: `growth:${id}` } : {}) },
  );
  await finish(r.ok ? "sent" : "failed", r.ok ? null : (r.error ?? "not sent"));
  return r.ok ? { ok: true, message: "Sent." } : { ok: false, message: `Not sent: ${r.error ?? "unknown reason"}.` };
}

export async function rejectSuggestion(tenantId: string, id: string, adminId: string, note: string): Promise<void> {
  await db()
    .from("growth_suggestions")
    .update({ status: "rejected", decided_by: adminId, decided_at: new Date().toISOString(), decision_note: note.slice(0, 300) || null })
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .eq("status", "pending");
}

/** Called by the 15-minute cron: run once a day at the chosen Gulf-time hour. */
export async function maybeRunGrowth(tenantId: string, now = new Date()): Promise<RunSummary | "not_due"> {
  const s = await getGrowthSettings(tenantId);
  if (!s.enabled) return "not_due";
  const gulf = (d: Date) => new Date(d.getTime() + 4 * 3600_000);
  const today = gulf(now).toISOString().slice(0, 10);
  if (gulf(now).getUTCHours() < s.runHour) return "not_due";
  if (s.lastRunAt && gulf(new Date(s.lastRunAt)).toISOString().slice(0, 10) === today) return "not_due";
  return runGrowth(tenantId);
}
