"use server";

import { AiError, callTool, isKnownModel } from "@/lib/ai/anthropic";
import { aiAccount, logAiUsage } from "@/lib/ai/settings";
import { audit, requireAdmin } from "@/lib/admin/auth";
import { bool, done, int, str } from "@/lib/admin/forms";
import { env } from "@/lib/env";
import { sealSecret } from "@/lib/secret-box";
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
