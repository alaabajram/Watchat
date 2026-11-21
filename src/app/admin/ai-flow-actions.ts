"use server";

// "Build with AI" on the three flow canvases (series flows, sequence flows, shared replies), and how it learns:
// rate a draft, see / edit what it has learned, and fold new signals into its house rules.

import { after } from "next/server";
import { audit, requireAdmin } from "@/lib/admin/auth";
import { agentContext, draftFlowWithAi, getLessons, learnLessons, saveLessons, type FlowDraftResult } from "@/lib/ai/flow-agent";
import { cleanTeamLessons, type Lesson } from "@/lib/ai/learning";
import { sanitizeGraph } from "@/lib/flows/sanitize";
import { loadSequenceBuilder } from "@/lib/flows/sequence-store";
import { loadSharedBuilder } from "@/lib/flows/shared-store";
import { loadBuilder } from "@/lib/flows/store";
import type { FlowKind } from "@/lib/flows/types";
import { allow } from "@/lib/security/rate-limit";
import { db } from "@/lib/supabase";

const UUID = /^[0-9a-f-]{36}$/;
const kindOf = (k: unknown): FlowKind => (k === "sequence" || k === "shared" ? k : "series");

/** Draft a new flow, or change the current one, on any canvas. The result goes on the canvas as the draft. */
export async function aiDraft(kind: FlowKind, targetId: string, request: string, mode: "change" | "new", current: unknown): Promise<FlowDraftResult> {
  const admin = await requireAdmin("bot");
  const k = kindOf(kind);
  const ask = String(request ?? "").trim().slice(0, 3000);
  if (ask.length < 5) return { ok: false, error: "Describe what you want." };
  if (!(await allow(`ai:${admin.id}`, 10, 600))) return { ok: false, error: "Too many AI requests. Wait a few minutes." };

  let ctx;
  let stats;
  let target = "shared";
  if (k === "series") {
    const b = UUID.test(targetId) ? await loadBuilder(admin.tenantId, targetId, admin.id) : null;
    if (!b) return { ok: false, error: "Series not found." };
    const { data: all } = await db().from("series").select("code").eq("tenant_id", admin.tenantId);
    ctx = agentContext(b, "series", (all ?? []).map((s) => s.code as string));
    stats = b.stats;
    target = targetId;
  } else if (k === "sequence") {
    const b = UUID.test(targetId) ? await loadSequenceBuilder(admin.tenantId, targetId) : null;
    if (!b) return { ok: false, error: "Sequence not found." };
    ctx = agentContext(b, "sequence", b.sequence.seriesCodes);
    target = targetId;
  } else {
    const b = await loadSharedBuilder(admin.tenantId);
    ctx = agentContext(b, "shared", b.shared.seriesCodes);
  }
  const cur = mode === "change" ? sanitizeGraph(current) : null;
  const result = await draftFlowWithAi({ tenantId: admin.tenantId, adminId: admin.id, ctx, request: ask, current: cur, targetId: target, stats });
  if (result.ok) await audit(admin, "flow.ai_draft", k, target, { mode, cards: result.graph.nodes.length, errors: result.errors.length, lessons: result.lessonsUsed });
  return result;
}

/** 👍 / 👎 and an optional note on a draft. Notes and 👎 teach the AI right away (in the background). */
export async function rateAiDraft(draftId: string, rating: 1 | -1 | 0, feedback: string): Promise<{ ok: boolean }> {
  const admin = await requireAdmin("bot");
  if (!UUID.test(draftId)) return { ok: false };
  const note = String(feedback ?? "").trim().slice(0, 1000);
  const { data } = await db()
    .from("ai_flow_drafts")
    .update({ rating: rating === 1 || rating === -1 ? rating : null, feedback: note || null, learned_at: null })
    .eq("tenant_id", admin.tenantId)
    .eq("id", draftId)
    .select("kind")
    .maybeSingle();
  if (!data) return { ok: false };
  const kind = kindOf(data.kind);
  if (note || rating === -1) after(() => learnLessons(admin.tenantId, admin.id, kind).then(() => undefined));
  return { ok: true };
}

export async function aiLessons(kind: FlowKind): Promise<{ rules: Lesson[]; signals: number; updatedAt: string | null; pending: number }> {
  const admin = await requireAdmin("bot");
  const k = kindOf(kind);
  const [lessons, { count }] = await Promise.all([
    getLessons(admin.tenantId, k),
    db().from("ai_flow_drafts").select("id", { count: "exact", head: true }).eq("tenant_id", admin.tenantId).eq("kind", k).is("learned_at", null).or("rating.not.is.null,feedback.not.is.null,edits.not.is.null"),
  ]);
  return { ...lessons, pending: count ?? 0 };
}

/** The team edits the rules: add their own, reword or remove any. */
export async function saveAiLessons(kind: FlowKind, rules: unknown): Promise<{ rules: Lesson[] }> {
  const admin = await requireAdmin("bot");
  const k = kindOf(kind);
  const cur = await getLessons(admin.tenantId, k);
  const next = cleanTeamLessons(rules, cur.rules, new Date().toISOString());
  await saveLessons(admin.tenantId, k, next);
  await audit(admin, "ai_lessons.edited", k, null, { rules: next.length });
  return { rules: next };
}

/** Fold every new rating, note and edit into the rules now (normally this happens by itself). */
export async function learnNow(kind: FlowKind): Promise<{ rules: Lesson[]; learned: number; error?: string }> {
  const admin = await requireAdmin("bot");
  if (!(await allow(`ai-learn:${admin.id}`, 5, 600))) return { ...(await getLessons(admin.tenantId, kindOf(kind))), learned: 0, error: "Too many requests. Wait a few minutes." };
  return learnLessons(admin.tenantId, admin.id, kindOf(kind), { force: true });
}
