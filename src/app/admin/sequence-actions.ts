"use server";

// Sequence flow actions: create, autosave the draft, check, publish (syncs the Trigger card to the
// sequence's trigger / delay / series so sequence_candidates picks the right viewers), pause / resume, delete.

import { redirect } from "next/navigation";
import { after } from "next/server";
import { audit, requireAdmin } from "@/lib/admin/auth";
import { learnLessons, recordPublished } from "@/lib/ai/flow-agent";
import { sanitizeGraph } from "@/lib/flows/sanitize";
import { starterSequence } from "@/lib/flows/sequence-store";
import { hasErrors, validateSequence, type Issue } from "@/lib/flows/validate";
import { db } from "@/lib/supabase";

const UUID = /^[0-9a-f-]{36}$/;

async function ctxFor(tenantId: string) {
  const [{ data: templates }, { data: series }] = await Promise.all([
    db().from("wa_templates").select("name, meta_status").eq("tenant_id", tenantId),
    db().from("series").select("id, code").eq("tenant_id", tenantId),
  ]);
  const names = new Map<string, boolean>();
  for (const t of templates ?? []) names.set(t.name, (names.get(t.name) ?? false) || t.meta_status === "APPROVED");
  return {
    ctx: { templates: [...names].map(([name, approved]) => ({ name, approved })), seriesCodes: (series ?? []).map((s) => s.code as string) },
    seriesIdByCode: new Map((series ?? []).map((s) => [s.code as string, s.id as string])),
  };
}

async function own(tenantId: string, id: string) {
  if (!UUID.test(id)) throw new Error("Bad sequence id");
  const { data } = await db().from("sequences").select("id, version").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (!data) throw new Error("Sequence not found");
  return data;
}

export async function createSequence(form: FormData) {
  const admin = await requireAdmin("messaging");
  const name = String(form.get("name") ?? "").trim().slice(0, 80) || "New sequence";
  const draft = starterSequence();
  const ch = String(form.get("channel") ?? "both");
  const channel = ["both", "whatsapp", "telegram"].includes(ch) ? ch : "both";
  const { data, error } = await db()
    .from("sequences")
    .insert({ tenant_id: admin.tenantId, name, trigger: "stopped_mid_series", delay_hours: 24, template_name: null, active: false, draft, channel })
    .select("id")
    .single();
  if (error || !data) redirect(`/admin/sequences?err=${encodeURIComponent(error?.message ?? "Couldn't create the sequence")}`);
  await audit(admin, "sequence.created", "sequence", data.id, { name });
  redirect(`/admin/flows/sequence/${data.id}`);
}

export async function saveSequenceDraft(id: string, graph: unknown): Promise<{ ok: true; savedAt: string } | { ok: false; error: string }> {
  const admin = await requireAdmin("messaging");
  const clean = sanitizeGraph(graph);
  if (!clean) return { ok: false, error: "The sequence is too big or malformed." };
  await own(admin.tenantId, id);
  const savedAt = new Date().toISOString();
  const { error } = await db().from("sequences").update({ draft: clean, updated_at: savedAt }).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true, savedAt };
}

export async function checkSequence(id: string, graph: unknown): Promise<Issue[]> {
  const admin = await requireAdmin("messaging");
  await own(admin.tenantId, id);
  const clean = sanitizeGraph(graph);
  if (!clean) return [{ level: "error", message: "The sequence is too big or malformed." }];
  return validateSequence(clean, (await ctxFor(admin.tenantId)).ctx);
}

export async function publishSequence(
  id: string,
  graph: unknown,
  note: string,
): Promise<{ ok: true; version: number; versionId: string; issues: Issue[] } | { ok: false; issues: Issue[]; error?: string }> {
  const admin = await requireAdmin("messaging");
  const row = await own(admin.tenantId, id);
  const clean = sanitizeGraph(graph);
  if (!clean) return { ok: false, issues: [], error: "The sequence is too big or malformed." };
  const { ctx, seriesIdByCode } = await ctxFor(admin.tenantId);
  const issues = validateSequence(clean, ctx);
  if (hasErrors(issues)) return { ok: false, issues };

  const trigger = clean.nodes.find((n) => n.data.kind === "trigger")!.data as Extract<typeof clean.nodes[number]["data"], { kind: "trigger" }>;
  const version = (row.version as number) + 1;
  const now = new Date().toISOString();
  const { error } = await db()
    .from("sequences")
    .update({
      draft: clean,
      graph: clean,
      version,
      published_at: now,
      note: note.slice(0, 300) || null,
      trigger: trigger.trigger,
      delay_hours: trigger.delayHours,
      series_id: trigger.seriesCode ? (seriesIdByCode.get(trigger.seriesCode) ?? null) : null,
      active: true,
      updated_at: now,
    })
    .eq("id", id);
  if (error) return { ok: false, issues, error: error.message };
  await audit(admin, "sequence.published", "sequence", id, { version, cards: clean.nodes.length });
  // Build with AI learns from what the team changed in its draft before publishing.
  after(async () => {
    if (await recordPublished(admin.tenantId, "sequence", id, clean)) await learnLessons(admin.tenantId, admin.id, "sequence");
  });
  return { ok: true, version, versionId: id, issues };
}

export async function setSequenceActive(form: FormData) {
  const admin = await requireAdmin("messaging");
  const id = String(form.get("id") ?? "");
  const active = form.get("active") === "1";
  await own(admin.tenantId, id);
  const { data } = await db().from("sequences").select("graph, template_name").eq("id", id).single();
  if (active && !data?.graph && !data?.template_name) redirect(`/admin/sequences?err=${encodeURIComponent("Publish the sequence before turning it on.")}`);
  await db().from("sequences").update({ active, updated_at: new Date().toISOString() }).eq("id", id);
  await audit(admin, active ? "sequence.resumed" : "sequence.paused", "sequence", id, {});
  redirect(`/admin/sequences?ok=${encodeURIComponent(active ? "Sequence is on." : "Sequence paused. Viewers already in it finish their current step.")}`);
}

export async function deleteSequence(form: FormData) {
  const admin = await requireAdmin("messaging");
  const id = String(form.get("id") ?? "");
  await own(admin.tenantId, id);
  await db().from("sequences").delete().eq("id", id);
  await audit(admin, "sequence.deleted", "sequence", id, {});
  redirect(`/admin/sequences?ok=${encodeURIComponent("Sequence deleted.")}`);
}

/** Who a sequence runs for: both chat apps, WhatsApp only (paid templates) or Telegram only (free messages). */
export async function setSequenceChannel(id: string, channel: string): Promise<{ ok: boolean }> {
  const admin = await requireAdmin("messaging");
  if (!/^[0-9a-f-]{36}$/.test(id) || !["both", "whatsapp", "telegram"].includes(channel)) return { ok: false };
  const { error } = await db().from("sequences").update({ channel, updated_at: new Date().toISOString() }).eq("id", id).eq("tenant_id", admin.tenantId);
  if (!error) await audit(admin, "sequence.channel", "sequence", id, { channel });
  return { ok: !error };
}
