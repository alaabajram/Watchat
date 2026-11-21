// Server side of "Build with AI" on every flow canvas: uses the label's own AI account, asks for the
// whole flow as steps, converts it to cards, and asks once more if the checks find errors.
// It learns: each draft is recorded (ai_flow_drafts) with the team's rating / note and, when the canvas is
// published, what they changed; those signals are folded into short house rules (ai_flow_lessons) that
// every later draft follows (see learning.ts).

import type { CardStat } from "../ctr/ctr";
import type { BuilderData } from "../flows/store";
import type { FlowGraph, FlowKind } from "../flows/types";
import { sanitizeGraph } from "../flows/sanitize";
import { db } from "../supabase";
import { AiError, callTool } from "./anthropic";
import { flowSystemPrompt, flowTool, graphToSteps, parseScript, scriptIssues, stepsToGraph, type AgentContext } from "./flow-draft";
import {
  cardResults,
  draftEdits,
  hasEdits,
  learnedPrompt,
  lessonsSystemPrompt,
  lessonsUserPrompt,
  LESSONS_TOOL,
  mergeLessons,
  type DraftEdits,
  type Lesson,
  type Signal,
  type TextEdit,
} from "./learning";
import { aiAccount, logAiUsage } from "./settings";

export function agentContext(b: BuilderData, mode: FlowKind = "series", seriesCodes: string[] = []): AgentContext {
  return {
    mode,
    seriesCodes,
    code: b.code,
    titleAr: b.series.titleAr,
    titleEn: b.series.titleEn,
    episodeCount: b.series.episodeCount,
    clips: Object.entries(b.series.clips)
      .filter(([, c]) => c.ar || c.en)
      .map(([n]) => Number(n))
      .sort((a, z) => a - z),
    hasPoster: Boolean(b.series.posterUrl),
    hasTrailer: Boolean(b.series.trailerUrl),
    assets: b.assets.map((a) => ({ id: a.id, name: a.name, kind: a.kind, url: a.url })),
    templates: b.templates.map((t) => ({ name: t.name, approved: t.approved, bodyAr: t.bodyAr })),
    otherSeries: b.series.others ?? [],
  };
}

export type FlowDraftResult =
  | { ok: true; graph: FlowGraph; summary: string; notes: string; errors: string[]; draftId: string | null; lessonsUsed: number }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// What the AI has learned
// ---------------------------------------------------------------------------

export async function getLessons(tenantId: string, kind: FlowKind): Promise<{ rules: Lesson[]; signals: number; updatedAt: string | null }> {
  const { data } = await db().from("ai_flow_lessons").select("rules, signals, updated_at").eq("tenant_id", tenantId).eq("kind", kind).maybeSingle();
  return { rules: Array.isArray(data?.rules) ? (data!.rules as Lesson[]) : [], signals: (data?.signals as number) ?? 0, updatedAt: (data?.updated_at as string) ?? null };
}

export async function saveLessons(tenantId: string, kind: FlowKind, rules: Lesson[], addSignals = 0): Promise<void> {
  const cur = await getLessons(tenantId, kind);
  await db()
    .from("ai_flow_lessons")
    .upsert({ tenant_id: tenantId, kind, rules, signals: cur.signals + addSignals, updated_at: new Date().toISOString() }, { onConflict: "tenant_id,kind" });
}

/** Recent before → after rewrites the team made in published AI drafts (concrete examples for the prompt). */
async function recentRewrites(tenantId: string, kind: FlowKind): Promise<TextEdit[]> {
  const { data } = await db()
    .from("ai_flow_drafts")
    .select("edits")
    .eq("tenant_id", tenantId)
    .eq("kind", kind)
    .not("edits", "is", null)
    .order("published_at", { ascending: false })
    .limit(5);
  return (data ?? []).flatMap((r) => ((r.edits as DraftEdits | null)?.texts ?? []).filter((t) => t.before && t.after && t.field.endsWith("(ar)")).slice(0, 2)).slice(0, 6);
}

/**
 * Fold new signals (ratings, notes, edits not learned yet) into the house rules. Called after the team rates a
 * draft or publishes one; runs only when there's something new. Returns the rules (unchanged when nothing new).
 */
export async function learnLessons(tenantId: string, adminId: string | null, kind: FlowKind, opts: { force?: boolean } = {}): Promise<{ rules: Lesson[]; learned: number; error?: string }> {
  const { data: rows } = await db()
    .from("ai_flow_drafts")
    .select("id, request, rating, feedback, edits")
    .eq("tenant_id", tenantId)
    .eq("kind", kind)
    .is("learned_at", null)
    .order("created_at", { ascending: true })
    .limit(20);
  const signals: (Signal & { id: string })[] = (rows ?? [])
    .map((r) => ({ id: r.id as string, request: r.request as string, rating: (r.rating as -1 | 1 | null) ?? null, feedback: (r.feedback as string | null) ?? null, edits: (r.edits as DraftEdits | null) ?? null }))
    .filter((s) => s.rating !== null || s.feedback?.trim() || (s.edits && hasEdits(s.edits)) || (s.edits && s.rating === null));
  const current = await getLessons(tenantId, kind);
  if (!signals.length) return { rules: current.rules, learned: 0 };
  // Plain 👍 with no note and no edits teaches nothing new on its own: wait for more unless asked.
  const informative = signals.filter((s) => s.feedback?.trim() || (s.edits && hasEdits(s.edits)) || s.rating === -1);
  if (!informative.length && !opts.force) return { rules: current.rules, learned: 0 };

  const account = await aiAccount(tenantId);
  if (!account.ok) return { rules: current.rules, learned: 0, error: account.reason };
  try {
    const r = await callTool({
      apiKey: account.apiKey,
      model: account.model,
      system: lessonsSystemPrompt(kind),
      turns: [{ role: "user", content: lessonsUserPrompt(current.rules, signals) }],
      tool: LESSONS_TOOL,
      maxTokens: 3000,
    });
    await logAiUsage({ tenantId, adminId, purpose: "flow_lessons", model: account.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, ok: true });
    const rules = mergeLessons(current.rules, r.input, new Date().toISOString());
    await saveLessons(tenantId, kind, rules, signals.length);
    await db().from("ai_flow_drafts").update({ learned_at: new Date().toISOString() }).in("id", signals.map((s) => s.id));
    return { rules, learned: signals.length };
  } catch (e) {
    const message = e instanceof AiError ? e.message : "AI request failed.";
    await logAiUsage({ tenantId, adminId, purpose: "flow_lessons", model: account.model, ok: false, error: message });
    return { rules: current.rules, learned: 0, error: message };
  }
}

/**
 * The canvas was published: compare it with the latest AI draft for it (last 30 days, not compared yet)
 * and keep what the team changed. Returns true when there was a draft to learn from.
 */
export async function recordPublished(tenantId: string, kind: FlowKind, targetId: string, published: FlowGraph): Promise<boolean> {
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const { data } = await db()
    .from("ai_flow_drafts")
    .select("id, graph")
    .eq("tenant_id", tenantId)
    .eq("kind", kind)
    .eq("target_id", targetId)
    .is("published_at", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const ai = data ? sanitizeGraph(data.graph) : null;
  if (!data || !ai) return false;
  const edits = draftEdits(ai, published);
  // Older unpublished drafts of the same canvas were superseded: close them without learning from them.
  await db().from("ai_flow_drafts").update({ published_at: new Date().toISOString(), learned_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("kind", kind).eq("target_id", targetId).is("published_at", null).neq("id", data.id);
  await db().from("ai_flow_drafts").update({ edits, published_at: new Date().toISOString() }).eq("id", data.id);
  return true;
}

// ---------------------------------------------------------------------------
// Drafting
// ---------------------------------------------------------------------------

export async function draftFlowWithAi(opts: {
  tenantId: string;
  adminId: string;
  ctx: AgentContext;
  request: string;
  current: FlowGraph | null; // null = start a new flow
  targetId: string;
  stats?: Record<string, CardStat>;
}): Promise<FlowDraftResult> {
  const account = await aiAccount(opts.tenantId);
  if (!account.ok) return { ok: false, error: account.reason };
  const kind = opts.ctx.mode ?? "series";

  const [lessons, examples] = await Promise.all([getLessons(opts.tenantId, kind), recentRewrites(opts.tenantId, kind)]);
  const results = opts.current && opts.stats ? cardResults(opts.current, opts.stats) : undefined;
  const system = flowSystemPrompt(opts.ctx, learnedPrompt({ lessons: lessons.rules, examples, results }));

  const what = kind === "sequence" ? "sequence" : kind === "shared" ? "set of shared replies" : "flow for this series";
  const base = opts.current
    ? `Here is the current ${kind === "shared" ? "set of replies" : kind === "sequence" ? "sequence" : "flow"} as steps:\n${JSON.stringify(graphToSteps(opts.current))}\n\nChange it as follows, keeping everything else: ${opts.request}`
    : `Write a new ${what}: ${opts.request}`;
  let content = base;
  let best: { graph: FlowGraph; summary: string; notes: string; errors: string[] } | null = null;
  const tool = flowTool(kind);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await callTool({ apiKey: account.apiKey, model: account.model, system, turns: [{ role: "user", content }], tool, maxTokens: 20000 });
      await logAiUsage({ tenantId: opts.tenantId, adminId: opts.adminId, purpose: `flow_draft_${kind}`, model: account.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, ok: true });
      const script = parseScript(r.input);
      if (!script.steps.length) throw new AiError("The AI returned an empty flow. Try again with more detail.");
      const graph = stepsToGraph(script.steps, opts.ctx, opts.current);
      const errors = scriptIssues(graph, opts.ctx)
        .filter((i) => i.level === "error")
        .map((i) => (i.nodeId ? `step ${i.nodeId}: ${i.message}` : i.message));
      if (!best || errors.length < best.errors.length) best = { graph, summary: script.summary, notes: script.notes, errors };
      if (!errors.length) break;
      content = `${base}\n\nYour last version had these problems; fix them all and return the complete ${kind === "shared" ? "replies" : kind} again:\n- ${errors.join("\n- ")}\n\nYour last version:\n${JSON.stringify(script.steps)}`;
    } catch (e) {
      const message = e instanceof AiError ? e.message : "AI request failed.";
      await logAiUsage({ tenantId: opts.tenantId, adminId: opts.adminId, purpose: `flow_draft_${kind}`, model: account.model, ok: false, error: message });
      if (best) break;
      return { ok: false, error: message };
    }
  }

  const { data: row } = await db()
    .from("ai_flow_drafts")
    .insert({ tenant_id: opts.tenantId, kind, target_id: opts.targetId, admin_id: opts.adminId, request: opts.request.slice(0, 3000), graph: best!.graph, errors: best!.errors.length })
    .select("id")
    .single();
  return { ok: true, ...best!, draftId: (row?.id as string | undefined) ?? null, lessonsUsed: lessons.rules.length };
}
