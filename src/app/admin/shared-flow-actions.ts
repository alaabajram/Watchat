"use server";

// Shared replies on the flow builder canvas: autosave the draft, check, publish, start over from the standard
// replies, and the few texts the bot still sends on its own (not on any card).

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { audit, requireAdmin } from "@/lib/admin/auth";
import { learnLessons, recordPublished } from "@/lib/ai/flow-agent";
import { COPY, type CopyKey } from "@/lib/bot/copy";
import { sanitizeGraph } from "@/lib/flows/sanitize";
import { standardSharedFlow } from "@/lib/flows/shared";
import { FIXED_TEXT_KEYS, sharedTexts } from "@/lib/flows/shared-store";
import type { FlowGraph } from "@/lib/flows/types";
import { hasErrors, validateShared, type Issue } from "@/lib/flows/validate";
import { db } from "@/lib/supabase";

async function seriesCodes(tenantId: string): Promise<string[]> {
  const { data } = await db().from("series").select("code").eq("tenant_id", tenantId);
  return (data ?? []).map((s) => s.code as string);
}

export async function saveSharedDraft(graph: unknown): Promise<{ ok: true; savedAt: string } | { ok: false; error: string }> {
  const admin = await requireAdmin("bot");
  const clean = sanitizeGraph(graph);
  if (!clean) return { ok: false, error: "The flow is too big or malformed." };
  const savedAt = new Date().toISOString();
  const { error } = await db()
    .from("shared_flows")
    .upsert({ tenant_id: admin.tenantId, draft: clean, draft_updated_at: savedAt, updated_at: savedAt }, { onConflict: "tenant_id" });
  return error ? { ok: false, error: error.message } : { ok: true, savedAt };
}

export async function checkShared(graph: unknown): Promise<Issue[]> {
  const admin = await requireAdmin("bot");
  const clean = sanitizeGraph(graph);
  if (!clean) return [{ level: "error", message: "The flow is too big or malformed." }];
  return validateShared(clean, { seriesCodes: await seriesCodes(admin.tenantId) });
}

export async function publishShared(
  graph: unknown,
  note: string,
): Promise<{ ok: true; version: number; versionId: string; issues: Issue[] } | { ok: false; issues: Issue[]; error?: string }> {
  const admin = await requireAdmin("bot");
  const clean = sanitizeGraph(graph);
  if (!clean) return { ok: false, issues: [], error: "The flow is too big or malformed." };
  const issues = validateShared(clean, { seriesCodes: await seriesCodes(admin.tenantId) });
  if (hasErrors(issues)) return { ok: false, issues };

  const { data: row } = await db().from("shared_flows").select("version").eq("tenant_id", admin.tenantId).maybeSingle();
  const version = ((row?.version as number | undefined) ?? 0) + 1;
  const now = new Date().toISOString();
  const { error } = await db()
    .from("shared_flows")
    .upsert(
      { tenant_id: admin.tenantId, draft: clean, draft_updated_at: now, graph: clean, version, published_at: now, published_by: admin.id, updated_at: now },
      { onConflict: "tenant_id" },
    );
  if (error) return { ok: false, issues, error: error.message };
  await audit(admin, "shared_flow.published", "shared_flows", null, { version, cards: clean.nodes.length, note: note.slice(0, 300) || null });
  revalidatePath("/admin/bot");
  // Build with AI learns from what the team changed in its draft before publishing.
  after(async () => {
    if (await recordPublished(admin.tenantId, "shared", "shared", clean)) await learnLessons(admin.tenantId, admin.id, "shared");
  });
  return { ok: true, version, versionId: "shared", issues };
}

/** The standard shared replies (menu, link, account, STOP, deletion), with the saved texts. */
export async function standardShared(): Promise<FlowGraph> {
  const admin = await requireAdmin("bot");
  return standardSharedFlow(await sharedTexts(admin.tenantId));
}

/** Texts the bot sends on its own (unknown code, other series, picks, pin tip…). Same rules as before: empty or default = default. */
export async function saveFixedTexts(values: Record<string, string>): Promise<{ ok: boolean; message: string }> {
  const admin = await requireAdmin("bot");
  let custom = 0;
  for (const key of FIXED_TEXT_KEYS) {
    for (const lang of ["ar", "en"] as const) {
      const raw = String(values[`${key}.${lang}`] ?? "").trim();
      const max = COPY[key as CopyKey].kind === "button" ? 20 : 1000;
      if (Array.from(raw).length > max) return { ok: false, message: `"${COPY[key].label}" (${lang}) is longer than ${max} characters.` };
      if (raw && raw !== COPY[key][lang]) {
        custom++;
        const { error } = await db()
          .from("bot_messages")
          .upsert({ tenant_id: admin.tenantId, series_id: null, key, lang, body: raw, updated_by: admin.id, updated_at: new Date().toISOString() }, { onConflict: "tenant_id,series_id,key,lang" });
        if (error) return { ok: false, message: `Save failed: ${error.message}` };
      } else {
        await db().from("bot_messages").delete().eq("tenant_id", admin.tenantId).eq("key", key).eq("lang", lang).is("series_id", null);
      }
    }
  }
  await audit(admin, "bot_messages.saved", "shared_replies", null, { overrides: custom, from: "fixed_texts" });
  return { ok: true, message: custom ? `Saved · ${custom} custom texts` : "Saved · all defaults" };
}
