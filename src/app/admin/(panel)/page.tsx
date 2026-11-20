// Dashboard: the funnel by series and traffic source, plus revenue and WhatsApp spend.

import { Flash } from "@/components/admin/Flash";
import { SpendMeter } from "@/components/admin/SpendMeter";
import { can, requireAdmin } from "@/lib/admin/auth";
import { loadMonthSpend } from "@/lib/spend/store";
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function KpiIcon({ d, bg, fg }: { d: string; bg: string; fg: string }) {
  return (
    <span className="kpi-icon" style={{ background: bg }} aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={fg} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
      </svg>
    </span>
  );
}

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

  const meter = can(admin, "spend") ? await loadMonthSpend(admin.tenantId).catch(() => null) : null;
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

      {meter && <SpendMeter m={meter} compact />}

      <div className="kpis">
        <div className="kpi">
          <KpiIcon d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM10 8.5v7l5.5-3.5z" bg="#e3fbf1" fg="#0e9a6a" />
          <span className="muted">Episode 1 completion</span>
          <strong>{top ? Math.round((ep1 / top) * 100) : 0}%</strong>
        </div>
        <div className="kpi">
          <KpiIcon d="M6 11V8a6 6 0 0 1 12 0v3M5 11h14v10H5zM12 15v2" bg="#ffece8" fg="#d6402e" />
          <span className="muted">Paywall → paid</span>
          <strong>{paywall ? Math.round((paidCount / paywall) * 100) : 0}%</strong>
        </div>
        <div className="kpi">
          <KpiIcon d="M12 21a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM9.5 10h4a1.75 1.75 0 0 1 0 3.5h-3a1.75 1.75 0 0 0 0 3.5h4M12 8v1.5M12 17v1.5" bg="#fff4dc" fg="#b7791f" />
          <span className="muted">Revenue</span>
          <strong>{Object.entries(revenue).map(([c, v]) => `${c} ${v.toFixed(2)}`).join(" · ") || "—"}</strong>
        </div>
        <div className="kpi">
          <KpiIcon d="M21 12a8 8 0 0 1-11.8 7L4 20.5l1.5-5A8 8 0 1 1 21 12z" bg="#e8f2ff" fg="#1f6fd1" />
          <span className="muted">Marketing messages sent</span>
          <strong>{marketing}</strong>
          {failed > 0 && <span style={{ color: "var(--a-coral-text)", fontSize: 13, fontWeight: 500 }}>{failed} failed</span>}
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>
          Funnel <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>· distinct viewers</span>
        </h2>
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
                    <div style={{ height: 10, borderRadius: 999, background: "var(--a-line)" }}>
                      <div className="bar" style={{ width: `${Math.max(1, (v / top) * 100)}%`, opacity: v === 0 ? 0.35 : 1 }} />
                    </div>
                  </td>
                  <td className="muted" style={{ width: 150, whiteSpace: "nowrap" }}>
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
