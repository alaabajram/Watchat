// AI account: each label connects its own Anthropic API key. The key is encrypted and never shown again.

import { Flash } from "@/components/admin/Flash";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { AI_MODELS } from "@/lib/ai/anthropic";
import { getAiSettings } from "@/lib/ai/settings";
import { requireAdmin } from "@/lib/admin/auth";
import { db } from "@/lib/supabase";
import { removeAiKeyAction, saveAiSettingsAction, testAiAction } from "../../ai-actions";

export const dynamic = "force-dynamic";

export default async function AiAccountPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const admin = await requireAdmin("aiAccount");
  const sp = await searchParams;
  const s = await getAiSettings(admin.tenantId);
  const { data: recent } = await db()
    .from("ai_usage")
    .select("purpose, model, input_tokens, output_tokens, ok, error, created_at")
    .eq("tenant_id", admin.tenantId)
    .order("created_at", { ascending: false })
    .limit(15);

  return (
    <>
      <h1>AI account</h1>
      <Flash ok={sp.ok} err={sp.err} />
      <div className="card">
        <p style={{ marginTop: 0 }}>
          This label uses its own Claude account for <strong>Build with AI</strong> in Bot messages & scenarios. AI usage is billed to that account by
          Anthropic.
        </p>
        <ol className="muted" style={{ marginBottom: 0 }}>
          <li>Sign in at console.anthropic.com with the label&apos;s company account and add credit under Billing.</li>
          <li>Go to API keys → Create key, name it after this label, and copy it (it starts with sk-ant-).</li>
          <li>Paste it below. It&apos;s encrypted and can&apos;t be viewed again, only replaced or removed.</li>
        </ol>
      </div>

      <div className="card">
        <p style={{ marginTop: 0 }}>
          Status:{" "}
          {s.connected ? (
            <strong>Connected · key ending …{s.keyLast4}</strong>
          ) : (
            <strong>Not connected</strong>
          )}{" "}
          · {s.usedThisMonth} of {s.monthlyLimit} requests used this month{!s.enabled && " · switched off"}
        </p>
        <form action={saveAiSettingsAction} style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 520 }}>
          <label>
            {s.connected ? "Replace API key (leave empty to keep the current one)" : "Anthropic API key"}
            <input name="api_key" type="password" autoComplete="off" placeholder="sk-ant-…" style={{ width: "100%" }} />
          </label>
          <label>
            Model
            <select name="model" defaultValue={s.model}>
              {AI_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Monthly limit (AI requests)
            <input name="monthly_request_limit" type="number" min={0} max={100000} defaultValue={s.monthlyLimit} />
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" name="enabled" defaultChecked={s.enabled} /> AI enabled for this label
          </label>
          <p style={{ margin: 0 }}>
            <button type="submit">Save</button>
          </p>
        </form>
        {s.connected && (
          <div className="row" style={{ marginTop: 12, gap: 8 }}>
            <form action={testAiAction}>
              <SubmitButton className="secondary" pending="Testing…">
                Test connection
              </SubmitButton>
            </form>
            <form action={removeAiKeyAction}>
              <button type="submit" className="secondary">
                Remove key
              </button>
            </form>
          </div>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Recent AI requests</h2>
        {recent?.length ? (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>For</th>
                <th>Model</th>
                <th>Tokens in / out</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r, i) => (
                <tr key={i}>
                  <td>{new Date(r.created_at).toLocaleString("en-GB", { timeZone: "Asia/Dubai" })}</td>
                  <td>{r.purpose === "scenario_draft" ? "Scenario draft" : "Connection test"}</td>
                  <td>{r.model}</td>
                  <td>
                    {r.input_tokens.toLocaleString()} / {r.output_tokens.toLocaleString()}
                  </td>
                  <td>{r.ok ? "OK" : r.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No AI requests yet.</p>
        )}
      </div>
    </>
  );
}
