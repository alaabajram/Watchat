"use server";

import { isKnownModel, callTool, AiError } from "@/lib/ai/anthropic";
import { draftScenario, loadSeriesContext } from "@/lib/ai/scenario-agent";
import { isEmptyDraft, type ScenarioDraft } from "@/lib/ai/scenario-draft";
import { aiAccount, logAiUsage } from "@/lib/ai/settings";
import { audit, requireAdmin } from "@/lib/admin/auth";
import { bool, done, int, str, uuid } from "@/lib/admin/forms";
import { env } from "@/lib/env";
import { sealSecret } from "@/lib/secret-box";
import { allow } from "@/lib/security/rate-limit";
import { db } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// AI account (owner only): the label's own Anthropic key, model and monthly limit
// ---------------------------------------------------------------------------

export async function saveAiSettingsAction(fd: FormData) {
  const admin = await requireAdmin("aiAccount");
  const back = "/admin/ai";
  const key = str(fd, "api_key", 300);
  const model = str(fd, "model", 60);
  const limit = int(fd, "monthly_request_limit", 200);
  if (!isKnownModel(model)) done(back, "Pick a model from the list.", "err");
  if (limit < 0 || limit > 100000) done(back, "Monthly limit must be 0–100000 requests.", "err");
  if (key && !/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) done(back, "That doesn't look like an Anthropic API key (it starts with sk-ant-).", "err");

  const row: Record<string, unknown> = {
    tenant_id: admin.tenantId,
    model,
    monthly_request_limit: limit,
    enabled: bool(fd, "enabled"),
    updated_by: admin.id,
    updated_at: new Date().toISOString(),
  };
  if (key) {
    row.api_key_enc = sealSecret(key, env.settingsEncryptionKey);
    row.api_key_last4 = key.slice(-4);
  }
  const { error } = await db().from("tenant_ai_settings").upsert(row, { onConflict: "tenant_id" });
  if (error) done(back, `Save failed: ${error.message}`, "err");
  await audit(admin, key ? "ai.key_saved" : "ai.settings_saved", "tenant", admin.tenantId, { model, limit });
  done(back, key ? "AI key saved. Use “Test connection” to check it." : "Saved.");
}

export async function removeAiKeyAction() {
  const admin = await requireAdmin("aiAccount");
  await db().from("tenant_ai_settings").update({ api_key_enc: null, api_key_last4: null, updated_by: admin.id, updated_at: new Date().toISOString() }).eq("tenant_id", admin.tenantId);
  await audit(admin, "ai.key_removed", "tenant", admin.tenantId);
  done("/admin/ai", "AI key removed.");
}

export async function testAiAction() {
  const admin = await requireAdmin("aiAccount");
  const account = await aiAccount(admin.tenantId);
  if (!account.ok) done("/admin/ai", account.reason, "err");
  try {
    const r = await callTool({
      apiKey: account.apiKey,
      model: account.model,
      system: "Reply through the tool.",
      turns: [{ role: "user", content: "Say ok." }],
      tool: {
        name: "reply",
        description: "Reply",
        input_schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false },
      },
      maxTokens: 2000,
    });
    await logAiUsage({ tenantId: admin.tenantId, adminId: admin.id, purpose: "test", model: account.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, ok: true });
  } catch (e) {
    const message = e instanceof AiError ? e.message : "AI request failed.";
    await logAiUsage({ tenantId: admin.tenantId, adminId: admin.id, purpose: "test", model: account.model, ok: false, error: message });
    done("/admin/ai", message, "err");
  }
  done("/admin/ai", `Connected ✓ ${account.model} answered.`);
}

// ---------------------------------------------------------------------------
// Build with AI: draft → review → apply (or discard)
// ---------------------------------------------------------------------------

type DraftRow = { id: string; series_id: string; prompt: string; draft: ScenarioDraft; status: string };

async function loadDraft(tenantId: string, id: string | null): Promise<DraftRow | null> {
  if (!id) return null;
  const { data } = await db().from("ai_drafts").select("id, series_id, prompt, draft, status").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  return (data as DraftRow | null) ?? null;
}

export async function draftScenarioAction(fd: FormData) {
  const admin = await requireAdmin("bot");
  const seriesId = uuid(fd, "series_id");
  const request = str(fd, "request", 2000);
  const parent = await loadDraft(admin.tenantId, uuid(fd, "parent_id"));
  const back = `/admin/bot/ai${seriesId ? `?series=${seriesId}` : ""}`;
  if (!seriesId) done(back, "Pick a series.", "err");
  if (request.length < 5) done(back, "Describe what the scenario should do.", "err");
  if (!(await allow(`ai:${admin.id}`, 10, 600))) done(back, "Too many AI requests. Wait a few minutes.", "err");

  const loaded = await loadSeriesContext(admin.tenantId, seriesId!);
  if (!loaded) done(back, "Series not found.", "err");
  const result = await draftScenario({
    tenantId: admin.tenantId,
    adminId: admin.id,
    loaded: loaded!,
    request,
    previous: parent && parent.series_id === seriesId ? { request: parent.prompt, draft: parent.draft } : null,
  });
  if (!result.ok) done(back, result.error, "err");

  const { data, error } = await db()
    .from("ai_drafts")
    .insert({
      tenant_id: admin.tenantId,
      series_id: seriesId,
      prompt: parent ? `${parent.prompt}\n→ ${request}` : request,
      draft: { ...result.draft, problems: result.problems },
      parent_id: parent?.id ?? null,
      created_by: admin.id,
    })
    .select("id")
    .single();
  if (error || !data) done(back, `Couldn't save the draft: ${error?.message ?? "unknown"}`, "err");
  if (parent?.status === "draft") await db().from("ai_drafts").update({ status: "discarded", decided_by: admin.id, decided_at: new Date().toISOString() }).eq("id", parent.id);
  await audit(admin, "ai.draft_created", "series", seriesId, { draft: data!.id, changes: result.draft.messages.length + Object.keys(result.draft.scenario).length });
  done(`/admin/bot/ai?draft=${data!.id}`, isEmptyDraft(result.draft) ? "The AI suggested no changes." : "Draft ready. Review it below.");
}

export async function applyDraftAction(fd: FormData) {
  const admin = await requireAdmin("bot");
  const row = await loadDraft(admin.tenantId, uuid(fd, "draft_id"));
  if (!row || row.status !== "draft") done("/admin/bot/ai", "This draft was already applied or discarded.", "err");
  const back = `/admin/bot/ai?draft=${row!.id}`;
  const { scenario, messages } = row!.draft;
  const now = new Date().toISOString();

  const seriesUpdate: Record<string, unknown> = {};
  if (scenario.askLanguage !== undefined) seriesUpdate.ask_language = scenario.askLanguage;
  if (scenario.sendTrailer !== undefined) seriesUpdate.send_trailer = scenario.sendTrailer;
  if (scenario.askOptIn !== undefined) seriesUpdate.ask_opt_in = scenario.askOptIn;
  if (scenario.waEpisodeCount !== undefined) seriesUpdate.wa_episode_count = scenario.waEpisodeCount;
  if (Object.keys(seriesUpdate).length) {
    const { error } = await db().from("series").update(seriesUpdate).eq("tenant_id", admin.tenantId).eq("id", row!.series_id);
    if (error) done(back, `Couldn't update the scenario: ${error.message}`, "err");
  }

  if (messages.length) {
    const rows = messages.flatMap((m) =>
      (["ar", "en"] as const).map((lang) => ({
        tenant_id: admin.tenantId,
        series_id: row!.series_id,
        key: m.key,
        lang,
        body: m[lang],
        updated_by: admin.id,
        updated_at: now,
      })),
    );
    const { error } = await db().from("bot_messages").upsert(rows, { onConflict: "tenant_id,series_id,key,lang" });
    if (error) done(back, `Couldn't save the texts: ${error.message}`, "err");
  }

  await db().from("ai_drafts").update({ status: "applied", decided_by: admin.id, decided_at: now }).eq("id", row!.id);
  await audit(admin, "ai.draft_applied", "series", row!.series_id, { draft: row!.id, scenario: seriesUpdate, texts: messages.map((m) => m.key) });
  done(back, "Applied. New chats for this series use it now.");
}

export async function discardDraftAction(fd: FormData) {
  const admin = await requireAdmin("bot");
  const row = await loadDraft(admin.tenantId, uuid(fd, "draft_id"));
  if (row?.status === "draft") {
    await db().from("ai_drafts").update({ status: "discarded", decided_by: admin.id, decided_at: new Date().toISOString() }).eq("id", row.id);
    await audit(admin, "ai.draft_discarded", "series", row.series_id, { draft: row.id });
  }
  done(`/admin/bot/ai${row ? `?series=${row.series_id}` : ""}`, "Draft discarded.");
}
