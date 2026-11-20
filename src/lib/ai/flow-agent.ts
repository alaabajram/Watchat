// Server side of "Build with AI" in the flow builder: uses the label's own AI account, asks for the
// whole flow as steps, converts it to cards, and asks once more if the checks find errors.

import type { FlowGraph } from "../flows/types";
import type { BuilderData } from "../flows/store";
import { AiError, callTool } from "./anthropic";
import { FLOW_TOOL, flowSystemPrompt, graphToSteps, parseScript, scriptIssues, stepsToGraph, type AgentContext } from "./flow-draft";
import { aiAccount, logAiUsage } from "./settings";

export function agentContext(b: BuilderData): AgentContext {
  return {
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
  | { ok: true; graph: FlowGraph; summary: string; notes: string; errors: string[] }
  | { ok: false; error: string };

export async function draftFlowWithAi(opts: {
  tenantId: string;
  adminId: string;
  ctx: AgentContext;
  request: string;
  current: FlowGraph | null; // null = start a new flow
}): Promise<FlowDraftResult> {
  const account = await aiAccount(opts.tenantId);
  if (!account.ok) return { ok: false, error: account.reason };

  const base = opts.current
    ? `Here is the current flow as steps:\n${JSON.stringify(graphToSteps(opts.current))}\n\nChange it as follows, keeping everything else: ${opts.request}`
    : `Write a new flow for this series: ${opts.request}`;
  let content = base;
  let best: { graph: FlowGraph; summary: string; notes: string; errors: string[] } | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await callTool({ apiKey: account.apiKey, model: account.model, system: flowSystemPrompt(opts.ctx), turns: [{ role: "user", content }], tool: FLOW_TOOL, maxTokens: 20000 });
      await logAiUsage({ tenantId: opts.tenantId, adminId: opts.adminId, purpose: "flow_draft", model: account.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, ok: true });
      const script = parseScript(r.input);
      if (!script.steps.length) throw new AiError("The AI returned an empty flow. Try again with more detail.");
      const graph = stepsToGraph(script.steps, opts.ctx, opts.current);
      const errors = scriptIssues(graph, opts.ctx)
        .filter((i) => i.level === "error")
        .map((i) => (i.nodeId ? `step ${i.nodeId}: ${i.message}` : i.message));
      if (!best || errors.length < best.errors.length) best = { graph, summary: script.summary, notes: script.notes, errors };
      if (!errors.length) break;
      content = `${base}\n\nYour last flow had these problems; fix them all and return the complete flow again:\n- ${errors.join("\n- ")}\n\nYour last flow:\n${JSON.stringify(script.steps)}`;
    } catch (e) {
      const message = e instanceof AiError ? e.message : "AI request failed.";
      await logAiUsage({ tenantId: opts.tenantId, adminId: opts.adminId, purpose: "flow_draft", model: account.model, ok: false, error: message });
      if (best) break;
      return { ok: false, error: message };
    }
  }
  return { ok: true, ...best! };
}
