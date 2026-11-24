// Admin → Studio: story episodes in production with Claude (+ OpenArt), as a board by stage; new briefs; the
// OpenArt credit budget; and the Watchat connector addresses for Claude.

import Link from "next/link";
import { Flash } from "@/components/admin/Flash";
import { can, requireAdmin } from "@/lib/admin/auth";
import { monthStart } from "@/lib/studio/budget";
import { sanitizeNotes, openNotes, STAGE_INFO, STAGES, type Stage } from "@/lib/studio/stages";
import { sanitizeStory } from "@/lib/story/sanitize";
import { db } from "@/lib/supabase";
import { createBriefAction, createConnectorAction, revokeConnectorAction, saveStudioSettingsAction } from "../../studio-actions";

export const dynamic = "force-dynamic";

type Row = {
  episode_id: string;
  stage: Stage;
  brief: string | null;
  notes: unknown;
  credits_used: number;
  updated_at: string;
  episodes: { number: number; title_en: string | null; story_draft: unknown };
  series: { id: string; code: string; title_en: string };
};

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

export default async function StudioPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const admin = await requireAdmin("content");
  const sp = await searchParams;
  const [{ data: items }, { data: stories }, { data: settings }, { data: log }, { data: tokens }] = await Promise.all([
    db()
      .from("studio_items")
      .select("episode_id, stage, brief, notes, credits_used, updated_at, episodes!inner(number, title_en, story_draft), series!inner(id, code, title_en)")
      .eq("tenant_id", admin.tenantId)
      .order("updated_at", { ascending: false })
      .limit(200),
    db().from("series").select("id, code, title_en, story_bible").eq("tenant_id", admin.tenantId).eq("format", "story").order("created_at", { ascending: false }),
    db().from("studio_settings").select("monthly_credits, episode_credits, usd_per_credit").eq("tenant_id", admin.tenantId).maybeSingle(),
    db().from("studio_credit_log").select("credits").eq("tenant_id", admin.tenantId).gte("created_at", monthStart()),
    db().from("studio_tokens").select("id, label, created_at, expires_at, last_used_at, admin_id, admin_users(name, email)").eq("tenant_id", admin.tenantId).is("revoked_at", null).order("created_at", { ascending: false }),
  ]);
  const rows = (items ?? []) as unknown as Row[];
  const monthly = settings?.monthly_credits ?? 24000;
  const episodeCap = settings?.episode_credits ?? 2500;
  const usd = Number(settings?.usd_per_credit ?? 0.0015);
  const used = (log ?? []).reduce((a, r) => a + (r.credits ?? 0), 0);
  const pct = monthly ? Math.min(100, Math.round((used / monthly) * 100)) : 100;
  const columns = STAGES.filter((s) => s !== "published");
  const published = rows.filter((r) => r.stage === "published");

  return (
    <>
      <h1>Studio</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Story episodes made with Claude and OpenArt. You write a brief → Claude writes the script → you approve it → Claude makes the pictures → you check the
        episode and publish. Claude can never publish, and it asks this budget before every picture.
      </p>
      <Flash ok={sp.ok} err={sp.err} />

      <div className="grid2" style={{ alignItems: "start" }}>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>OpenArt credits this month</h2>
          <div style={{ height: 12, borderRadius: 99, background: "#eee", overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: pct > 90 ? "#dc2626" : pct > 70 ? "#f59e0b" : "#16a34a" }} />
          </div>
          <p style={{ marginBottom: 0 }}>
            <strong>{used.toLocaleString()}</strong> of {monthly.toLocaleString()} credits used · {Math.max(0, monthly - used).toLocaleString()} left (≈ $
            {(Math.max(0, monthly - used) * usd).toFixed(2)}) · cap {episodeCap.toLocaleString()} per episode
          </p>
          {can(admin, "team") && (
            <details style={{ marginTop: 10 }}>
              <summary style={{ cursor: "pointer" }}>Change the budget</summary>
              <form action={saveStudioSettingsAction} className="grid3" style={{ marginTop: 10, alignItems: "end" }}>
                <label>
                  Credits per month
                  <input name="monthly_credits" type="number" min={0} defaultValue={monthly} />
                </label>
                <label>
                  Cap per episode
                  <input name="episode_credits" type="number" min={0} defaultValue={episodeCap} />
                </label>
                <label>
                  $ per credit
                  <input name="usd_per_credit" type="number" step="0.0001" min={0} defaultValue={usd} />
                </label>
                <span className="muted" style={{ gridColumn: "1 / -1", fontSize: 13 }}>
                  Set the monthly number to your OpenArt plan&apos;s credits (Pro 24,000; Wonder 106,000) or lower, so Claude stops before the plan runs out.
                </span>
                <button type="submit">Save budget</button>
              </form>
            </details>
          )}
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>New episode brief</h2>
          {(stories ?? []).length === 0 ? (
            <p className="muted">No story series yet. Create one with Launch a series → Story, or turn a series into a story series in its Story builder tab.</p>
          ) : (
            <form action={createBriefAction} style={{ display: "grid", gap: 8 }}>
              <div className="grid2">
                <label>
                  Series
                  <select name="series_id" required>
                    {(stories ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.code} · {s.title_en}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Episode (empty = next)
                  <input name="episode" type="number" min={1} />
                </label>
              </div>
              <label>
                What happens in this episode
                <textarea name="brief" rows={4} required placeholder="Amal arrives in Hanoi and loses her backpack; Nasser's hotel booking doesn't exist. End: they both get a second message from the unknown number." />
              </label>
              <button type="submit">Send to Claude</button>
            </form>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: `repeat(${columns.length}, minmax(190px, 1fr))`, gap: 10, overflowX: "auto", margin: "8px 0 16px" }}>
        {columns.map((stage) => {
          const list = rows.filter((r) => r.stage === stage);
          const info = STAGE_INFO[stage];
          return (
            <div key={stage} style={{ background: info.who === "team" ? "#fff7e8" : "#f4f2ee", borderRadius: 16, padding: 10, minHeight: 160 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <strong>{info.label}</strong>
                <span className="muted" style={{ fontSize: 12 }}>{list.length}</span>
              </div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                {info.who === "team" ? "👤 " : info.who === "claude" ? "✨ " : ""}
                {info.hint}
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                {list.map((r) => {
                  const g = r.episodes.story_draft ? sanitizeStory(r.episodes.story_draft) : null;
                  const pics = g ? g.scenes.filter((x) => x.image || x.video).length : 0;
                  const open = openNotes(sanitizeNotes(r.notes)).length;
                  return (
                    <Link key={r.episode_id} href={`/admin/studio/${r.episode_id}`} className="card" style={{ margin: 0, padding: 10, display: "block", textDecoration: "none", color: "inherit" }}>
                      <div style={{ fontSize: 12, fontWeight: 700 }}>
                        {r.series.code} · Ep {r.episodes.number}
                      </div>
                      <div style={{ fontWeight: 600 }}>{r.episodes.title_en ?? ""}</div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {g ? `${g.scenes.length} scenes · pictures ${pics}/${g.scenes.length}` : (r.brief ?? "").slice(0, 70)}
                      </div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {r.credits_used ? `${r.credits_used} credits · ` : ""}
                        {open ? `${open} open note${open > 1 ? "s" : ""} · ` : ""}
                        {ago(r.updated_at)}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {published.length > 0 && (
        <p className="muted">
          Published from the Studio: {published.map((r) => `${r.series.code} ep ${r.episodes.number}`).join(", ")}.
        </p>
      )}

      <div className="grid2" style={{ alignItems: "start" }}>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Series bibles</h2>
          <p className="muted" style={{ marginTop: 0 }}>The style line, dialect, rules and character looks Claude must follow. Lock a bible once you approve the character portraits.</p>
          <ul style={{ margin: 0, paddingInlineStart: 18 }}>
            {(stories ?? []).map((s) => {
              const b = (s.story_bible ?? {}) as { locked?: boolean; style?: string };
              return (
                <li key={s.id}>
                  <Link href={`/admin/studio/bible/${s.id}`}>
                    {s.code} · {s.title_en}
                  </Link>{" "}
                  <span className="muted" style={{ fontSize: 12 }}>{b.locked ? "🔒 locked" : b.style ? "draft" : "empty"}</span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Connect Claude</h2>
          <ol style={{ marginTop: 0, paddingInlineStart: 18, lineHeight: 1.6 }}>
            <li>Create a connector address below and copy it (it&apos;s shown once).</li>
            <li>
              In claude.ai: Settings → Connectors → <strong>Add custom connector</strong>, name it <strong>Watchat</strong>, paste the address, Add.
            </li>
            <li>Also add OpenArt the same way (address https://mcp.openart.ai/mcp) and sign in.</li>
            <li>
              In a new chat, switch both on and say: <em>&quot;Write episode 2 of HOLIDAY01&quot;</em>. Claude follows the rules this connector gives it.
            </li>
          </ol>
          <form action={createConnectorAction} className="row" style={{ gap: 8 }}>
            <input name="label" placeholder="Label, e.g. Alaa's Claude" maxLength={60} />
            <button type="submit">Create connector address</button>
          </form>
          {(tokens ?? []).length > 0 && (
            <table style={{ marginTop: 10 }}>
              <tbody>
                {(tokens ?? []).map((t) => {
                  const who = (t as unknown as { admin_users?: { name: string | null; email: string } }).admin_users;
                  return (
                    <tr key={t.id}>
                      <td>
                        {t.label} <span className="muted" style={{ fontSize: 12 }}>· {who?.name ?? who?.email}</span>
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>
                        {t.last_used_at ? `used ${ago(t.last_used_at)}` : "never used"} · ends {new Date(t.expires_at).toLocaleDateString()}
                      </td>
                      <td>
                        {(t.admin_id === admin.id || admin.role === "owner") && (
                          <form action={revokeConnectorAction}>
                            <input type="hidden" name="id" value={t.id} />
                            <button type="submit" className="secondary" style={{ padding: "3px 10px", fontSize: 12 }}>
                              Remove
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
