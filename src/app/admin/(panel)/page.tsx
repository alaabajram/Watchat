// Dashboard: the funnel by series and traffic source, plus revenue and WhatsApp spend.

import { Flash } from "@/components/admin/Flash";
import { requireAdmin } from "@/lib/admin/auth";
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type SP = { days?: string; series?: string; source?: string; ok?: string; err?: string; denied?: string };

export default async function Dashboard({ searchParams }: { searchParams: Promise<SP> }) {
  const admin = await requireAdmin("dashboard");
  const sp = await searchParams;
  const days = [7, 30, 90].includes(Number(sp.days)) ? Number(sp.days) : 30;
  const series = sp.series && /^[0-9a-f-]{36}$/.test(sp.series) ? sp.series : null;
  const source = sp.source === "ctwa_ad" || sp.source === "organic" ? sp.source : null;
  const since = new Date(Date.now() - days * 86400_000).toISOString();

  const [{ data: funnel }, { data: seriesList }, { data: paid }, { data: msgs }] = await Promise.all([
    db().rpc("admin_funnel", { p_tenant: admin.tenantId, p_since: since, p_series: series, p_source: source }),
    db().from("series").select("id, code, title_en").eq("tenant_id", admin.tenantId).order("created_at"),
    db().from("orders").select("amount, currency").eq("status", "paid").gte("paid_at", since),
    db().from("wa_messages").select("category, status").eq("direction", "out").gte("created_at", since),
  ]);

  const stages = (funnel ?? []) as { stage: string; viewers: number }[];
  const top = Math.max(1, Number(stages[0]?.viewers ?? 0));
  const revenue = (paid ?? []).reduce<Record<string, number>>((acc, o) => {
    acc[o.currency] = (acc[o.currency] ?? 0) + Number(o.amount);
    return acc;
  }, {});
  const marketing = (msgs ?? []).filter((m) => m.category === "marketing" && m.status !== "failed").length;
  const failed = (msgs ?? []).filter((m) => m.status === "failed").length;
  const ep1 = Number(stages[1]?.viewers ?? 0);
  const paywall = Number(stages[4]?.viewers ?? 0);
  const paidCount = Number(stages[5]?.viewers ?? 0);

  return (
    <>
      <h1>Dashboard</h1>
      {sp.denied && <Flash err="Your role can't open that page." />}
      <Flash ok={sp.ok} err={sp.err} />
      <form className="row card" method="get">
        <label>
          Period
          <select name="days" defaultValue={String(days)}>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
        </label>
        <label>
          Series
          <select name="series" defaultValue={series ?? ""}>
            <option value="">All series</option>
            {(seriesList ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} · {s.title_en}
              </option>
            ))}
          </select>
        </label>
        <label>
          Traffic source
          <select name="source" defaultValue={source ?? ""}>
            <option value="">All sources</option>
            <option value="ctwa_ad">Click-to-WhatsApp ads</option>
            <option value="organic">Organic / creator / share</option>
          </select>
        </label>
        <button type="submit" style={{ alignSelf: "end" }}>
          Apply
        </button>
      </form>

      <div className="kpis">
        <div className="kpi">
          <span className="muted">Episode 1 completion</span>
          <strong>{top ? Math.round((ep1 / top) * 100) : 0}%</strong>
        </div>
        <div className="kpi">
          <span className="muted">Paywall → paid</span>
          <strong>{paywall ? Math.round((paidCount / paywall) * 100) : 0}%</strong>
        </div>
        <div className="kpi">
          <span className="muted">Revenue</span>
          <strong>{Object.entries(revenue).map(([c, v]) => `${c} ${v.toFixed(2)}`).join(" · ") || "—"}</strong>
        </div>
        <div className="kpi">
          <span className="muted">Marketing messages sent</span>
          <strong>{marketing}</strong>
          {failed > 0 && <span className="muted">{failed} failed</span>}
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Funnel (distinct viewers)</h2>
        <table>
          <tbody>
            {stages.map((s, i) => {
              const v = Number(s.viewers);
              const prev = i > 0 ? Number(stages[i - 1].viewers) : v;
              return (
                <tr key={s.stage}>
                  <td style={{ width: 220 }}>{s.stage.replace(/^\d /, "")}</td>
                  <td style={{ width: 80 }}>
                    <strong>{v}</strong>
                  </td>
                  <td>
                    <div className="bar" style={{ width: `${Math.max(1, (v / top) * 100)}%` }} />
                  </td>
                  <td className="muted" style={{ width: 120 }}>
                    {i > 0 && prev > 0 ? `${Math.round((v / prev) * 100)}% of previous` : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
