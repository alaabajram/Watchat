// Growth agent: reviews viewers who are slipping away and suggests what to send. Suggest mode: the team
// approves or rejects each suggestion (with a note the agent learns from). Autopilot unlocks once earned.

import Link from "next/link";
import { Flash } from "@/components/admin/Flash";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { requireAdmin } from "@/lib/admin/auth";
import { getAiSettings } from "@/lib/ai/settings";
import { autopilotReadiness, type ViewerSummary } from "@/lib/growth/agent";
import { getGrowthSettings, reviewStats } from "@/lib/growth/run";
import { db } from "@/lib/supabase";
import { approveSuggestionAction, rejectSuggestionAction, runGrowthNowAction, saveGrowthSettingsAction } from "../../growth-actions";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ACTION_LABEL: Record<string, string> = { template: "Send template", series_picks: "Send series picks", flag: "Team to check", none: "Leave alone" };
const PRIORITY: Record<number, string> = { 1: "High", 2: "Normal", 3: "Low" };
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "—");
const fill = (body: string, title: string, ep: number | null) => body.replace(/\{\{1\}\}/g, title).replace(/\{\{2\}\}/g, String(ep ?? ""));

function Snapshot({ s }: { s: Partial<ViewerSummary> }) {
  return (
    <div style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 2 }}>
      <span className="muted">
        Inactive {s.daysSinceActive ?? "?"} days · {s.language === "en" ? "English subs" : "Arabic"} {s.country ? `· ${s.country}` : ""} {s.paid ? "· has paid" : ""}
      </span>
      {(s.series ?? []).map((x) => (
        <span key={x.code}>
          <strong>{x.code}</strong> ep {x.watchedUpTo}/{x.episodes}
          {x.finished ? " ✓ finished" : ""} {x.lastWatchedDaysAgo != null ? `· ${x.lastWatchedDaysAgo} d ago` : ""}
        </span>
      ))}
      {(s.recentMessages ?? []).slice(0, 2).map((m, i) => (
        <span key={i} className="muted">
          ✉ {m.template} {m.daysAgo} d ago {m.cameBack ? "· came back" : "· no response"}
        </span>
      ))}
    </div>
  );
}

export default async function GrowthPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const admin = await requireAdmin("growth");
  const sp = await searchParams;
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const [settings, ai, stats, { data: pending }, { data: recent }, { data: month }, { data: templates }, { data: series }] = await Promise.all([
    getGrowthSettings(admin.tenantId),
    getAiSettings(admin.tenantId),
    reviewStats(admin.tenantId),
    db()
      .from("growth_suggestions")
      .select("id, viewer_id, action, series_id, episode, template_name, options, reason, priority, snapshot, created_at, viewers(wa_profile_name, language)")
      .eq("tenant_id", admin.tenantId)
      .eq("status", "pending")
      .order("priority")
      .order("created_at", { ascending: false })
      .limit(60),
    db()
      .from("growth_suggestions")
      .select("id, viewer_id, action, template_name, status, reason, decision_note, decided_at, sent_at, returned_at, error, viewers(wa_profile_name)")
      .eq("tenant_id", admin.tenantId)
      .in("status", ["sent", "rejected", "failed"])
      .order("decided_at", { ascending: false })
      .limit(20),
    db().from("growth_suggestions").select("status, action, created_at, sent_at, returned_at").eq("tenant_id", admin.tenantId).gte("created_at", since),
    db().from("wa_templates").select("name, lang, body, button_text, meta_status").eq("tenant_id", admin.tenantId),
    db().from("series").select("id, code, title_ar, title_en").eq("tenant_id", admin.tenantId),
  ]);
  const readiness = autopilotReadiness(stats.reviewed, stats.approved);
  const seriesById = new Map((series ?? []).map((s) => [s.id, s]));
  const seriesByCode = new Map((series ?? []).map((s) => [s.code, s]));
  const tpl = (name: string | null, lang: "ar" | "en") => (templates ?? []).find((t) => t.name === name && t.lang === lang) ?? (templates ?? []).find((t) => t.name === name);
  const picksApproved = (templates ?? []).some((t) => t.name === "series_picks" && t.meta_status === "APPROVED");

  const m = month ?? [];
  const within3 = (start: string | null, ret: string | null) => Boolean(start && ret) && Date.parse(ret!) - Date.parse(start!) <= 3 * 86400_000;
  const sent = m.filter((x) => x.status === "sent");
  const hold = m.filter((x) => x.status === "holdout");
  const sentBack = sent.filter((x) => within3(x.sent_at, x.returned_at)).length;
  const holdBack = hold.filter((x) => within3(x.created_at, x.returned_at)).length;

  return (
    <>
      <h1>Growth agent</h1>
      <Flash ok={sp.ok} err={sp.err} />
      <div className="card">
        <p style={{ marginTop: 0 }}>
          Every day the agent looks at viewers who stopped watching (alerts on, inactive {settings.minInactiveDays}–30 days) and suggests the one message most
          likely to bring each back: a hint about the next episode of a series they were hooked on, or 2–3 series picked for them. You approve or reject each
          suggestion; it learns from your notes and from who actually came back.
        </p>
        <p className="muted" style={{ marginBottom: 0 }}>
          Every send follows the usual rules: alerts on, approved templates, no messages 22:00–09:00, at most one marketing message per viewer per 20 hours.
          {settings.holdoutPct}% of viewers get nothing, so you can see whether the messages really help.
        </p>
      </div>

      {!ai.connected && (
        <div className="card">
          <strong>Connect the AI account first.</strong> The agent uses this label&apos;s Claude key: <Link href="/admin/ai">AI account</Link>.
        </div>
      )}
      {!picksApproved && (
        <div className="card muted">
          Tip: add and get approval for the <code>series_picks</code> template (Flow builder → a Template card → Add starter templates) so the agent can
          offer 2–3 series per viewer.
        </div>
      )}

      <div className="kpis">
        <div className="kpi">
          <span className="muted">Waiting for you</span>
          <strong>{pending?.length ?? 0}</strong>
        </div>
        <div className="kpi">
          <span className="muted">Approved by the team (30 d)</span>
          <strong>{pct(stats.approved, stats.reviewed)}</strong>
          <span className="muted">{stats.reviewed} reviewed</span>
        </div>
        <div className="kpi">
          <span className="muted">Came back within 3 days</span>
          <strong>{pct(sentBack, sent.length)}</strong>
          <span className="muted">{sent.length} messages sent</span>
        </div>
        <div className="kpi">
          <span className="muted">Holdout came back on their own</span>
          <strong>{pct(holdBack, hold.length)}</strong>
          <span className="muted">{hold.length} viewers, no messages</span>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Suggestions to review</h2>
          <form action={runGrowthNowAction}>
            <SubmitButton className="secondary" pending="Reviewing viewers… up to a few minutes">
              Run now
            </SubmitButton>
          </form>
        </div>
        <p className="muted" style={{ marginTop: 4 }}>
          {settings.lastRunAt ? `Last run ${new Date(settings.lastRunAt).toLocaleString("en-GB", { timeZone: "Asia/Dubai" })}.` : "Not run yet."} Suggestions
          expire after 3 days.
        </p>
        {!pending?.length ? (
          <p className="muted">Nothing waiting. {settings.enabled ? `The next run is at ${settings.runHour}:00 Gulf time.` : "Switch the agent on below, or click Run now."}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 230 }}>Viewer</th>
                <th>Suggestion</th>
                <th style={{ width: 230 }}>Decide</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((g) => {
                const v = g.viewers as unknown as { wa_profile_name: string | null; language: string | null } | null;
                const lang = v?.language === "ar_en_subs" ? "en" : "ar";
                const s = g.series_id ? seriesById.get(g.series_id) : null;
                const t = tpl(g.template_name, lang);
                const title = s ? (lang === "en" ? s.title_en : s.title_ar) : "";
                return (
                  <tr key={g.id}>
                    <td>
                      <Link href={`/admin/viewers/${g.viewer_id}`}>{v?.wa_profile_name || "Viewer"}</Link> · {PRIORITY[g.priority] ?? "Normal"}
                      <Snapshot s={g.snapshot as Partial<ViewerSummary>} />
                    </td>
                    <td>
                      <strong>{ACTION_LABEL[g.action]}</strong>
                      {g.template_name && <span className="muted"> · {g.template_name}</span>}
                      {g.action === "series_picks" && (
                        <div style={{ fontSize: 12 }}>
                          Picks:{" "}
                          {((g.options as string[]) ?? [])
                            .map((c) => {
                              const x = seriesByCode.get(c);
                              return x ? `${c} (${x.title_ar})` : c;
                            })
                            .join(", ")}
                        </div>
                      )}
                      {t && (
                        <div dir={lang === "ar" ? "rtl" : "ltr"} style={{ background: "#efeae2", padding: 6, borderRadius: 8, marginTop: 4, fontSize: 13, whiteSpace: "pre-wrap", maxWidth: 420 }}>
                          <div style={{ background: "#fff", borderRadius: 6, padding: 6 }}>
                            {fill(t.body, title, g.episode)}
                            {t.button_text && <div style={{ color: "#027eb5", textAlign: "center", borderTop: "1px solid #eee", marginTop: 4, paddingTop: 4 }}>{t.button_text}</div>}
                          </div>
                        </div>
                      )}
                      <div style={{ marginTop: 4, fontSize: 13 }}>
                        <em>Why:</em> {g.reason}
                      </div>
                    </td>
                    <td>
                      {g.action !== "flag" && (
                        <form action={approveSuggestionAction} style={{ marginBottom: 6 }}>
                          <input type="hidden" name="id" value={g.id} />
                          <SubmitButton pending="Sending…">Approve & send</SubmitButton>
                        </form>
                      )}
                      <form action={rejectSuggestionAction} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <input type="hidden" name="id" value={g.id} />
                        <input name="note" placeholder={g.action === "flag" ? "What you did (optional)" : "Why not? (teaches the agent)"} maxLength={300} />
                        <button type="submit" className="secondary">
                          {g.action === "flag" ? "Done" : "Reject"}
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Settings</h2>
        <form action={saveGrowthSettingsAction} className="grid3">
          <label className="inline">
            <input type="checkbox" name="enabled" defaultChecked={settings.enabled} /> Run every day
          </label>
          <label>
            Run at (Gulf time)
            <select name="run_hour" defaultValue={settings.runHour}>
              {Array.from({ length: 13 }, (_, i) => i + 9).map((h) => (
                <option key={h} value={h}>
                  {h}:00
                </option>
              ))}
            </select>
          </label>
          <label>
            Viewers to review per day
            <input type="number" name="daily_limit" min={1} max={1000} defaultValue={settings.dailyLimit} />
          </label>
          <label>
            Inactive for at least (days)
            <input type="number" name="min_inactive_days" min={1} max={30} defaultValue={settings.minInactiveDays} />
          </label>
          <label>
            Holdout group (% who get nothing)
            <input type="number" name="holdout_pct" min={0} max={50} defaultValue={settings.holdoutPct} />
          </label>
          <label>
            Mode
            <select name="mode" defaultValue={settings.mode}>
              <option value="suggest">Suggest: the team approves each message</option>
              <option value="autopilot" disabled={!readiness.ready}>
                Autopilot: sends on its own{readiness.ready ? "" : " (locked)"}
              </option>
            </select>
            <span className="muted" style={{ fontWeight: 400 }}>
              {readiness.ready ? `Autopilot available: ${readiness.why}` : `Autopilot unlocks after 50 reviews with 75% approved. ${readiness.why}`}
            </span>
          </label>
          <div>
            <button type="submit">Save settings</button>
          </div>
        </form>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Recent decisions</h2>
        {!recent?.length ? (
          <p className="muted">None yet.</p>
        ) : (
          <table>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id}>
                  <td>{r.decided_at ? new Date(r.decided_at).toLocaleString("en-GB", { timeZone: "Asia/Dubai" }) : ""}</td>
                  <td>{(r.viewers as unknown as { wa_profile_name: string | null } | null)?.wa_profile_name || "Viewer"}</td>
                  <td>
                    {ACTION_LABEL[r.action]} {r.template_name ? `· ${r.template_name}` : ""}
                  </td>
                  <td>
                    <span className={`badge ${r.status === "sent" ? "sent" : r.status === "failed" ? "failed" : "draft"}`}>{r.status}</span>{" "}
                    {r.status === "sent" && (r.returned_at ? "· came back ✓" : "· no activity yet")}
                    {r.error && <span className="muted"> · {r.error}</span>}
                    {r.decision_note && <span className="muted"> · “{r.decision_note}”</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
