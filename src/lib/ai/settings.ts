// A label's AI account: its own API key (encrypted), model, and a monthly request limit.

import { env } from "../env";
import { openSecret } from "../secret-box";
import { db } from "../supabase";
import { DEFAULT_MODEL } from "./anthropic";

/** The viewer assistant on the web has its own daily limit and doesn't count toward the team's monthly one. */
export const ASSISTANT_PURPOSE = "viewer_assistant";
/** Cheapest, fastest model: the assistant only classifies short messages. */
export const ASSISTANT_MODEL = "claude-haiku-5-5";

function dayStart(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

/** The key for the viewer assistant, or why it can't use AI right now (it still answers without AI). */
export async function assistantAccount(tenantId: string): Promise<{ ok: true; apiKey: string; model: string } | { ok: false; reason: string }> {
  const { data } = await db()
    .from("tenant_ai_settings")
    .select("api_key_enc, enabled, assistant_enabled, assistant_daily_limit")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!data?.api_key_enc || !data.enabled || !data.assistant_enabled) return { ok: false, reason: "off" };
  const { count } = await db().from("ai_usage").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("purpose", ASSISTANT_PURPOSE).gte("created_at", dayStart());
  if ((count ?? 0) >= data.assistant_daily_limit) return { ok: false, reason: "daily limit" };
  try {
    return { ok: true, apiKey: openSecret(data.api_key_enc, env.settingsEncryptionKey), model: ASSISTANT_MODEL };
  } catch {
    return { ok: false, reason: "key unreadable" };
  }
}

export async function assistantSettings(tenantId: string): Promise<{ enabled: boolean; dailyLimit: number; usedToday: number; aiConnected: boolean }> {
  const [{ data }, { count }] = await Promise.all([
    db().from("tenant_ai_settings").select("api_key_enc, enabled, assistant_enabled, assistant_daily_limit").eq("tenant_id", tenantId).maybeSingle(),
    db().from("ai_usage").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("purpose", ASSISTANT_PURPOSE).gte("created_at", dayStart()),
  ]);
  return { enabled: data?.assistant_enabled ?? true, dailyLimit: data?.assistant_daily_limit ?? 300, usedToday: count ?? 0, aiConnected: Boolean(data?.api_key_enc && data.enabled) };
}

export type AiSettings = {
  connected: boolean;
  keyLast4: string | null;
  model: string;
  monthlyLimit: number;
  enabled: boolean;
  usedThisMonth: number;
  updatedAt: string | null;
};

function monthStart(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

export async function getAiSettings(tenantId: string): Promise<AiSettings> {
  const [{ data }, { count }] = await Promise.all([
    db()
      .from("tenant_ai_settings")
      .select("api_key_enc, api_key_last4, model, monthly_request_limit, enabled, updated_at")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    db().from("ai_usage").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).neq("purpose", ASSISTANT_PURPOSE).gte("created_at", monthStart()),
  ]);
  return {
    connected: Boolean(data?.api_key_enc),
    keyLast4: data?.api_key_last4 ?? null,
    model: data?.model ?? DEFAULT_MODEL,
    monthlyLimit: data?.monthly_request_limit ?? 200,
    enabled: data?.enabled ?? true,
    usedThisMonth: count ?? 0,
    updatedAt: data?.updated_at ?? null,
  };
}

/** The decrypted key and model, or a reason the label can't use AI right now. */
export async function aiAccount(tenantId: string): Promise<{ ok: true; apiKey: string; model: string } | { ok: false; reason: string }> {
  const { data } = await db()
    .from("tenant_ai_settings")
    .select("api_key_enc, model, monthly_request_limit, enabled")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!data?.api_key_enc) return { ok: false, reason: "No AI account is connected. The owner can add one in Admin → AI account." };
  if (!data.enabled) return { ok: false, reason: "AI is switched off for this label in Admin → AI account." };
  const { count } = await db().from("ai_usage").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).neq("purpose", ASSISTANT_PURPOSE).gte("created_at", monthStart());
  if ((count ?? 0) >= data.monthly_request_limit) return { ok: false, reason: `This month's AI limit (${data.monthly_request_limit} requests) is used up.` };
  try {
    return { ok: true, apiKey: openSecret(data.api_key_enc, env.settingsEncryptionKey), model: data.model };
  } catch {
    return { ok: false, reason: "The saved AI key can't be read (the encryption key changed). Paste the AI key again." };
  }
}

export async function logAiUsage(row: {
  tenantId: string;
  adminId: string | null; // null for scheduled runs
  purpose: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  ok: boolean;
  error?: string;
}): Promise<void> {
  const { error } = await db().from("ai_usage").insert({
    tenant_id: row.tenantId,
    admin_id: row.adminId || null,
    purpose: row.purpose,
    model: row.model,
    input_tokens: row.inputTokens ?? 0,
    output_tokens: row.outputTokens ?? 0,
    ok: row.ok,
    error: row.error?.slice(0, 300) ?? null,
  });
  if (error) console.error("[ai] usage log failed", error.message);
}
