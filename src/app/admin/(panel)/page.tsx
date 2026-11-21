// Dashboard: headline metrics (total / active / paying users, revenue) and the funnel for a date range,
// filtered by series and traffic source, plus WhatsApp spend.

import { adminMoney } from "@/lib/economy/pricing";
import Link from "next/link";
import { Flash } from "@/components/admin/Flash";
import { SpendMeter } from "@/components/admin/SpendMeter";
import { can, requireAdmin } from "@/lib/admin/auth";
import { PRESETS, resolveRange } from "@/lib/admin/date-range";
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

type SP = { range?: string; from?: string; to?: string; days?: string; series?: string; source?: string; ok?: string; err?: string; denied?: string };

const fmt = (n: number) => n.toLocaleString("en-US");
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");

const CHANNEL_COLOR = { whatsapp: "#25a35a", telegram: "#2481CC" } as const;

export default async function Dashboard({ searchParams }: { searchParams: Promise<SP> }) {
  const admin = await requireAdmin("dashboard");
  const sp = await searchParams;
  const range = resolveRange(sp);
  const series = sp.series && /^[0-9a-f-]{36}$/.test(sp.series) ? sp.series : null;
  const source = sp.source === "ctwa_ad" || sp.source === "organic" ? sp.source : null;
  const from = range.from.toISOString();
  const to = range.to.toISOString();

  const [{ data: funnel }, { data: seriesList }, { data: metricsRows }, { data: msgs }, { data: channelRows }] = await Promise.all([
    db().rpc("admin_funnel_range", { p_tenant: admin.tenantId, p_from: from, p_to: to, p_series: series, p_source: source }),
    db().from("series").select("id, code, title_en").eq("tenant_id", admin.tenantId).order("created_at"),
    db().rpc("admin_dashboard_metrics", { p_tenant: admin.tenantId, p_from: from, p_to: to, p_series: series, p_source: source }),
    db().from("wa_messages").select("category, status").eq("direction", "out").gte("created_at", from).lt("created_at", to),
    db().rpc("admin_channel_split", { p_tenant: admin.tenantId, p_from: from, p_to: to }),
  ]);
  type ChannelRow = { channel: "whatsapp" | "telegram"; total_users: number; new_users: number; active_users: number; paying_users: number; revenue: Record<string, number> };
  const channels = ((channelRows ?? []) as ChannelRow[]).map((c) => ({ ...c, total: Number(c.total_users) }));
  const channelTotal = channels.reduce((n, c) => n + c.total, 0);
  const m = ((metricsRows ?? []) as { total_users: number; new_users: number; active_users: number; paying_users: number; revenue: Record<string, number> }[])[0] ?? {
    total_users: 0,
    new_users: 0,
    active_users: 0,
    paying_users: 0,
    revenue: {},
  };
  const total = Number(m.total_users);
  const active = Number(m.active_users);
  const paying = Number(m.paying_users);
  const revenue = m.revenue ?? {};
  // Keep the series / source filters when switching dates.
  const keep = (extra: Record<string, string>) => {
    const q = new URLSearchParams(extra);
    if (series) q.set("series", series);
    if (source) q.set("source", source);
    return `/admin?${q.toString()}`;
  };

  const meter = can(admin, "spend") ? await loadMonthSpend(admin.tenantId).catch(() => null) : null;
  const stages = (funnel ?? []) as { stage: string; viewers: number }[];
  const top = Math.max(1, Number(stages[0]?.viewers ?? 0));
  const widest = Math.max(1, ...stages.map((s) => Number(s.viewers)));
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
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <nav aria-label="Date range" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {PRESETS.map((p) => (
            <Link
              key={p.key}
              href={keep({ range: p.key })}
              aria-current={range.preset === p.key ? "true" : undefined}
              style={{
                padding: "7px 14px",
                borderRadius: 999,
                textDecoration: "none",
                fontWeight: 600,
                fontSize: 13,
                background: range.preset === p.key ? "var(--a-text)" : "#f4f2ee",
                color: range.preset === p.key ? "#fff" : "var(--a-text)",
              }}
            >
              {p.label}
            </Link>
          ))}
        </nav>
        <form className="row" method="get" style={{ alignItems: "flex-end" }}>
          <label>
            From
            <input type="date" name="from" defaultValue={range.fromDay} max={range.toDay} required />
          </label>
          <label>
            To
            <input type="date" name="to" defaultValue={range.toDay} required />
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
          <button type="submit">Apply</button>
        </form>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Showing <strong style={{ color: "var(--a-text)" }}>{range.label}</strong> ({range.fromDay} to {range.toDay}, Dubai time)
        </p>
      </div>

      <div className="kpis">
        <div className="kpi">
          <KpiIcon d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14a6 6 0 0 1 3.5 6" bg="#e8f2ff" fg="#1f6fd1" />
          <span className="muted">Total users</span>
          <strong>{fmt(total)}</strong>
          <span className="muted" style={{ fontSize: 13 }}>+{fmt(Number(m.new_users))} new in this period</span>
        </div>
        <div className="kpi">
          <KpiIcon d="M3 12h4l3-8 4 16 3-8h4" bg="#e3fbf1" fg="#0e9a6a" />
          <span className="muted">Active users</span>
          <strong>{fmt(active)}</strong>
          <span className="muted" style={{ fontSize: 13 }}>{pct(active, total)} of all users</span>
        </div>
        <div className="kpi">
          <KpiIcon d="M4 7h16v12H4zM4 11h16M8 15h3" bg="#f1eaff" fg="#7a3fe0" />
          <span className="muted">Paying users</span>
          <strong>{fmt(paying)}</strong>
          <span className="muted" style={{ fontSize: 13 }}>{pct(paying, active)} of active users</span>
        </div>
        <div className="kpi">
          <KpiIcon d="M12 21a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM9.5 10h4a1.75 1.75 0 0 1 0 3.5h-3a1.75 1.75 0 0 0 0 3.5h4M12 8v1.5M12 17v1.5" bg="#fff4dc" fg="#b7791f" />
          <span className="muted">Revenue</span>
          <strong style={{ fontSize: Object.keys(revenue).length > 1 ? 22 : undefined }}>
            {Object.entries(revenue)
              .map(([c, v]) => adminMoney(Number(v), c))
              .join(" · ") || "—"}
          </strong>
          <span className="muted" style={{ fontSize: 13 }}>
            {paying > 0 && Object.keys(revenue).length === 1
              ? `${adminMoney(Number(Object.values(revenue)[0]) / paying, Object.keys(revenue)[0])} per paying user`
              : "Paid orders in this period"}
          </span>
        </div>
      </div>

      {channels.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>
            Users by chat app <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>· WhatsApp vs Telegram, all series and sources</span>
          </h2>
          <div aria-hidden="true" style={{ display: "flex", height: 10, borderRadius: 999, overflow: "hidden", background: "#f4f2ee", marginBottom: 14 }}>
            {channels.map((c) => (
              <span key={c.channel} style={{ width: `${channelTotal ? (c.total / channelTotal) * 100 : 0}%`, background: CHANNEL_COLOR[c.channel] }} />
            ))}
          </div>
          <table>
            <thead>
              <tr>
                <th>Chat app</th>
                <th>Total users</th>
                <th>Share</th>
                <th>New in period</th>
                <th>Active in period</th>
                <th>Paying in period</th>
                <th>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((c) => (
                <tr key={c.channel}>
                  <td>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
                      <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: "50%", background: CHANNEL_COLOR[c.channel] }} />
                      {c.channel === "telegram" ? "Telegram" : "WhatsApp"}
                    </span>
                  </td>
                  <td>{fmt(c.total)}</td>
                  <td>{pct(c.total, channelTotal)}</td>
                  <td>+{fmt(Number(c.new_users))}</td>
                  <td>{fmt(Number(c.active_users))}</td>
                  <td>{fmt(Number(c.paying_users))}</td>
                  <td>
                    {Object.entries(c.revenue ?? {})
                      .map(([cur, v]) => `${cur} ${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
                      .join(" · ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {meter && <SpendMeter m={meter} compact />}

      <div className="kpis" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        <div className="kpi">
          <KpiIcon d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM10 8.5v7l5.5-3.5z" bg="#e3fbf1" fg="#0e9a6a" />
          <span className="muted">Episode 1 completion</span>
          <strong>{top ? Math.min(100, Math.round((ep1 / top) * 100)) : 0}%</strong>
        </div>
        <div className="kpi">
          <KpiIcon d="M6 11V8a6 6 0 0 1 12 0v3M5 11h14v10H5zM12 15v2" bg="#ffece8" fg="#d6402e" />
          <span className="muted">Paywall → paid</span>
          <strong>{paywall ? Math.round((paidCount / paywall) * 100) : 0}%</strong>
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
            {/* Bars are relative to the biggest stage: a later stage can be bigger than an earlier one (viewers who
                arrive by a shared or web link skip "Chat started"), and a bar must never spill out of the card. */}
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
                      <div className="bar" style={{ width: `${Math.min(100, Math.max(1, (v / widest) * 100))}%`, opacity: v === 0 ? 0.35 : 1 }} />
                    </div>
                  </td>
                  <td className="muted" style={{ width: 170, whiteSpace: "nowrap" }}>
                    {i === 0 || prev === 0 ? "" : v > prev ? `+${v - prev} joined at this step` : `${Math.round((v / prev) * 100)}% of previous`}
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
