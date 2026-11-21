// Runs sequence flows (sequences built on the flow builder canvas). Called from runMessaging (cron, every
// 15 minutes, never during quiet hours). Two jobs:
//   1. start: viewers who reached the sequence's trigger moment (sequence_candidates, opted-in only) begin at
//      the Trigger card. The moment is claimed in sequence_sends first, so overlapping runs can't double-start.
//   2. resume: runs whose Wait card is due continue (claimed wait → running before anything is sent).
// Only Template cards send, through sendNamedTemplate (approved templates, opt-in for marketing, the 20-hour
// cap and the monthly budget pause). A sequence doesn't start new viewers until every template on it is approved.

import { runFrom, resumeAfterWait, type FlowEnv, type RunResult } from "../flows/engine";
import { sanitizeGraph } from "../flows/sanitize";
import type { Condition, FlowGraph } from "../flows/types";
import { templateNamesIn } from "../flows/validate";
import { db } from "../supabase";
import { sendNamedTemplate } from "./runner";
import { channelOfAddress, runsFor, type FlowChannel } from "../flows/types";

export type SequenceFlowSummary = { started: number; resumed: number; sent: number; skipped: number; failed: number; held: string[] };

type Seq = { id: string; name: string; tenant_id: string; graph: unknown; version: number };
type Run = {
  sequenceId: string;
  viewerId: string;
  ref: string;
  seriesId: string | null;
  episode: number | null;
  version: number;
  startedAt: number;
};
type ViewerRow = { id: string; phone_e164: string; language: string | null; last_seen_at: string | null; last_inbound_at: string | null };

const MAX_RESUMES = 300;

async function approvedTemplates(tenantId: string, names: string[]): Promise<boolean> {
  if (!names.length) return false;
  const { data } = await db().from("wa_templates").select("name").eq("tenant_id", tenantId).in("name", names).eq("meta_status", "APPROVED");
  const ok = new Set((data ?? []).map((t) => t.name as string));
  return names.every((n) => ok.has(n));
}

/** Answers a sequence Condition card. Exported for tests through `checkSequenceCondition`. */
export async function checkSequenceCondition(c: Condition, v: ViewerRow, run: Run, now: number): Promise<boolean> {
  switch (c.check) {
    case "on_telegram":
      return String(v.phone_e164 ?? "").startsWith("+tg:");
    case "came_back": {
      const back = Math.max(v.last_seen_at ? Date.parse(v.last_seen_at) : 0, v.last_inbound_at ? Date.parse(v.last_inbound_at) : 0);
      return back > run.startedAt;
    }
    case "paid_since":
    case "paid": {
      let q = db().from("orders").select("id", { count: "exact", head: true }).eq("viewer_id", v.id).eq("status", "paid");
      if (c.check === "paid_since") q = q.gte("paid_at", new Date(run.startedAt).toISOString());
      const { count } = await q;
      return (count ?? 0) > 0;
    }
    case "opted_in": {
      const { data } = await db().from("viewer_opt_in").select("status").eq("viewer_id", v.id).maybeSingle();
      return data?.status === "in";
    }
    case "language_en":
      return v.language === "ar_en_subs";
    case "watched_within": {
      let q = db()
        .from("progress")
        .select("episode_id, episodes!inner(series_id)", { count: "exact", head: true })
        .eq("viewer_id", v.id)
        .gte("updated_at", new Date(now - c.hours * 3600_000).toISOString());
      if (run.seriesId) q = q.eq("episodes.series_id", run.seriesId);
      const { count } = await q;
      return (count ?? 0) > 0;
    }
    default:
      return false;
  }
}

/** FlowEnv for a sequence: Template and Condition cards only; anything free-form is refused. */
function sequenceEnv(seq: Seq, v: ViewerRow, run: Run, now: number, budget: { left: number }, summary: SequenceFlowSummary): FlowEnv {
  const refuse = async () => {
    throw new Error("Sequences send templates only");
  };
  return {
    lang: v.language === "ar_en_subs" ? "en" : "ar",
    title: () => "Watchat",
    totalEpisodes: 0,
    send: refuse,
    knownLanguage: () => (v.language === "ar_en_subs" ? "en" : v.language ? "ar" : null),
    setLanguage: async () => {},
    optIn: async () => {
      const { data } = await db().from("viewer_opt_in").select("status").eq("viewer_id", v.id).maybeSingle();
      return (data?.status as "in" | "out" | undefined) ?? null;
    },
    setOptIn: async () => {},
    link: refuse,
    progress: async () => ({ maxStarted: 0, maxCompleted: 0, lastWatchedAt: null }),
    noteChatEpisode: () => {},
    clip: async () => ({ url: null, title: null }),
    mediaUrl: (ref) => ("assetId" in ref ? ref.url : null), // library pictures for template headers
    meta: () => ({ tagline: "", genre: "", cast: "" }),
    template: async (name, nodeId, headerImage) => {
      if (budget.left <= 0) return "skipped";
      budget.left--;
      const { data: opt } = await db().from("viewer_opt_in").select("status").eq("viewer_id", v.id).maybeSingle();
      const r = await sendNamedTemplate(
        { viewerId: v.id, phone: v.phone_e164, language: v.language, seriesId: run.seriesId, episode: run.episode },
        name,
        opt?.status === "in",
        { source: "sequence", ref: { type: "sequence", id: seq.id, node: nodeId }, headerImage },
      );
      if (r === "sent") summary.sent++;
      else if (r === "skipped") summary.skipped++;
      else summary.failed++;
      return r;
    },
    check: (c) => checkSequenceCondition(c, v, run, now),
    suggest: async () => {},
    seriesOptions: async () => [],
    canSendFreeform: () => false,
    track: async () => {},
    now: () => now,
  };
}

async function saveRun(run: Run, result: RunResult, now: number) {
  const patch =
    result.status === "wait"
      ? { status: "wait", node_id: result.nodeId, resume_at: new Date(result.resumeAt).toISOString() }
      : result.status === "blocked"
        ? { status: "blocked", node_id: result.nodeId, resume_at: null }
        : { status: "done", resume_at: null }; // "input" can't happen: sequences have no buttons to wait on
  await db()
    .from("sequence_runs")
    .update({ ...patch, updated_at: new Date(now).toISOString() })
    .eq("sequence_id", run.sequenceId)
    .eq("viewer_id", run.viewerId)
    .eq("ref", run.ref);
}

async function loadViewer(id: string): Promise<ViewerRow | null> {
  const { data } = await db().from("viewers").select("id, phone_e164, language, last_seen_at, last_inbound_at").eq("id", id).maybeSingle();
  return (data as ViewerRow) ?? null;
}

export async function runSequenceFlows(tenantId: string, now: Date, budget: { left: number }): Promise<SequenceFlowSummary> {
  const summary: SequenceFlowSummary = { started: 0, resumed: 0, sent: 0, skipped: 0, failed: 0, held: [] };
  const t = now.getTime();
  const { data: seqs } = await db().from("sequences").select("id, name, tenant_id, graph, version, active, channel").eq("tenant_id", tenantId).not("graph", "is", null);
  const graphs = new Map<string, { seq: Seq; g: FlowGraph }>();
  for (const s of seqs ?? []) {
    const g = sanitizeGraph(s.graph);
    if (g) graphs.set(s.id as string, { seq: s as Seq, g });
  }

  // 1. Resume runs whose Wait is due (paused sequences still let running viewers finish).
  const { data: due } = await db()
    .from("sequence_runs")
    .select("sequence_id, viewer_id, ref, series_id, episode_number, version, node_id, started_at")
    .eq("tenant_id", tenantId)
    .eq("status", "wait")
    .lte("resume_at", now.toISOString())
    .order("resume_at")
    .limit(MAX_RESUMES);
  for (const r of due ?? []) {
    if (budget.left <= 0) break;
    const { data: claimed } = await db()
      .from("sequence_runs")
      .update({ status: "running", updated_at: now.toISOString() })
      .eq("sequence_id", r.sequence_id)
      .eq("viewer_id", r.viewer_id)
      .eq("ref", r.ref)
      .eq("status", "wait")
      .select("viewer_id");
    if (!claimed?.length) continue;
    const run: Run = { sequenceId: r.sequence_id, viewerId: r.viewer_id, ref: r.ref, seriesId: r.series_id, episode: r.episode_number, version: r.version, startedAt: Date.parse(r.started_at) };
    const entry = graphs.get(r.sequence_id);
    const v = await loadViewer(r.viewer_id);
    try {
      // A republished sequence may no longer have this card: the run ends.
      if (!entry || !v || !entry.g.nodes.some((n) => n.id === r.node_id)) {
        await saveRun(run, { status: "done" }, t);
        continue;
      }
      const result = await resumeAfterWait(entry.g, r.node_id, sequenceEnv(entry.seq, v, run, t, budget, summary));
      await saveRun(run, result, t);
      summary.resumed++;
    } catch (e) {
      summary.failed++;
      console.error("[sequences] resume failed", { sequence: r.sequence_id, err: e instanceof Error ? e.message : e });
      await saveRun(run, { status: "blocked", nodeId: r.node_id, reason: "error" }, t);
    }
  }

  // 2. Start new viewers on active sequences.
  for (const s of seqs ?? []) {
    if (!s.active || budget.left <= 0) continue;
    const entry = graphs.get(s.id as string);
    const trigger = entry?.g.nodes.find((n) => n.data.kind === "trigger");
    if (!entry || !trigger) continue;
    // Telegram-only sequences send templates as free Telegram messages: no Meta approval needed.
    const seqChannel = ((s as { channel?: FlowChannel }).channel ?? "both") as FlowChannel;
    if (seqChannel !== "telegram" && !(await approvedTemplates(tenantId, templateNamesIn(entry.g)))) {
      summary.held.push(s.name as string); // waiting for Meta's approval: don't use up anyone's moment
      continue;
    }
    const { data: candidates, error } = await db().rpc("sequence_candidates", { p_sequence: s.id });
    if (error) {
      console.error("[sequences] candidates failed", s.id, error.message);
      continue;
    }
    for (const c of (candidates ?? []) as { viewer_id: string; phone_e164?: string; series_id: string | null; episode_number: number | null; ref: string }[]) {
      if (budget.left <= 0) break;
      if (!runsFor(seqChannel, channelOfAddress(c.phone_e164))) continue; // set for the other chat app
      // Claim the moment (sequence_candidates skips claimed ones), then create the run.
      const { error: claimError } = await db().from("sequence_sends").insert({ sequence_id: s.id, viewer_id: c.viewer_id, ref: c.ref, status: "flow" });
      if (claimError) continue;
      const run: Run = { sequenceId: s.id as string, viewerId: c.viewer_id, ref: c.ref, seriesId: c.series_id, episode: c.episode_number, version: s.version as number, startedAt: t };
      const { error: runError } = await db().from("sequence_runs").insert({
        tenant_id: tenantId,
        sequence_id: s.id,
        viewer_id: c.viewer_id,
        ref: c.ref,
        series_id: c.series_id,
        episode_number: c.episode_number,
        version: s.version,
        node_id: trigger.id,
        status: "running",
        started_at: now.toISOString(),
      });
      if (runError) continue;
      const v = await loadViewer(c.viewer_id);
      if (!v) continue;
      try {
        const result = await runFrom(entry.g, trigger.id, sequenceEnv(entry.seq, v, run, t, budget, summary));
        await saveRun(run, result, t);
        summary.started++;
      } catch (e) {
        summary.failed++;
        console.error("[sequences] start failed", { sequence: s.id, err: e instanceof Error ? e.message : e });
        await saveRun(run, { status: "blocked", nodeId: trigger.id, reason: "error" }, t);
      }
    }
  }
  return summary;
}
