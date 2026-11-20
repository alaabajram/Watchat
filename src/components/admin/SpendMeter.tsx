// WhatsApp spend meter: this month's spend against the budget, the month-end projection,
// spend as a share of revenue, and where the money goes. Server component (no client JS).

import Link from "next/link";
import { CATEGORIES, MARKET_LABELS, SOURCE_LABELS, type Market } from "@/lib/spend/meter";
import type { MonthSpend } from "@/lib/spend/store";

const usd = (n: number, digits = n < 100 ? 2 : 0) => `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;
const LEVEL_COLOR = { ok: "var(--a-brand)", alert: "#d97706", over: "#dc2626" } as const;
const CATEGORY_LABELS = { marketing: "Marketing templates", utility: "Utility templates", authentication: "Authentication", service: "Bot replies (service)" } as const;

function Share({ value, total }: { value: number; total: number }) {
  return <div className="bar" style={{ width: `${total > 0 ? Math.max(1, (value / total) * 100) : 0}%`, minWidth: value > 0 ? 2 : 0 }} />;
}

export function SpendMeter({ m, compact = false }: { m: MonthSpend; compact?: boolean }) {
  const { spend, settings } = m;
  const budget = settings.budget;
  const scale = Math.max(budget ?? 0, m.projected, spend.total, 0.01);
  const ofRevenue = m.revenueUsd > 0 ? spend.total / m.revenueUsd : null;
  const ratioColor = ofRevenue == null ? undefined : ofRevenue > 0.3 ? "#dc2626" : ofRevenue > 0.2 ? "#d97706" : "#16a34a";
  const free = spend.free.entryPoint + spend.free.customerService + spend.free.allowance + spend.free.other;

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>WhatsApp spend · {m.label}</h2>
        {compact && <Link href="/admin/spend">Full breakdown and budget →</Link>}
      </div>

      {/* The meter */}
      <div style={{ margin: "14px 0 6px", position: "relative", height: 18, background: "var(--a-line)", borderRadius: 9, overflow: "hidden" }}>
        <div style={{ position: "absolute", insetBlock: 0, insetInlineStart: 0, width: `${Math.min(100, (m.projected / scale) * 100)}%`, background: LEVEL_COLOR[m.level], opacity: 0.25 }} />
        <div style={{ position: "absolute", insetBlock: 0, insetInlineStart: 0, width: `${Math.min(100, (spend.total / scale) * 100)}%`, background: LEVEL_COLOR[m.level] }} />
        {budget != null && <div title="Budget" style={{ position: "absolute", insetBlock: 0, insetInlineStart: `calc(${Math.min(100, (budget / scale) * 100)}% - 2px)`, width: 3, background: "var(--a-text)" }} />}
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        Spent <strong style={{ color: "var(--a-text)" }}>{usd(spend.total)}</strong>
        {budget != null ? ` of ${usd(budget, 0)} budget (${pct(spend.total / budget)})` : " · no monthly budget set"}
        {m.projected > spend.total + 0.005 ? ` · heading for ${usd(m.projected)} by month-end (light bar)` : ""}
        {spend.estimated > 0.005 ? ` · ${usd(spend.estimated)} is an estimate until Meta prices the latest messages` : ""}
      </p>
      {m.level === "alert" && <p className="flash flash-err" style={{ marginBottom: 0 }}>Past {settings.alertPct}% of this month&apos;s budget.</p>}
      {m.level === "over" && (
        <p className="flash flash-err" style={{ marginBottom: 0 }}>
          Over budget.{settings.stopMarketing ? " Marketing templates are paused until next month; bot replies keep working." : " Marketing templates are still sending."}
        </p>
      )}

      <div className="kpis" style={{ marginTop: 14, marginBottom: compact ? 12 : 16 }}>
        <div className="kpi">
          <span className="muted">Spent this month</span>
          <strong>{usd(spend.total)}</strong>
          <span className="muted">{spend.charged.toLocaleString()} charged messages</span>
        </div>
        <div className="kpi">
          <span className="muted">Projected month-end</span>
          <strong>{usd(m.projected)}</strong>
          {budget != null && <span className="muted">{m.projected > budget ? `${usd(m.projected - budget)} over budget` : `${usd(budget - m.projected)} under budget`}</span>}
        </div>
        <div className="kpi">
          <span className="muted">Share of revenue</span>
          <strong style={{ color: ratioColor }}>{ofRevenue == null ? "—" : pct(ofRevenue)}</strong>
          <span className="muted">Revenue {usd(m.revenueUsd)} (excl. VAT)</span>
        </div>
        <div className="kpi">
          <span className="muted">Free messages</span>
          <strong>{spend.messages ? pct(free / spend.messages) : "—"}</strong>
          <span className="muted">
            {free.toLocaleString()} of {spend.messages.toLocaleString()} sent
          </span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: compact ? "1fr 1fr" : "1fr", gap: 16 }}>
        <table>
          <thead>
            <tr>
              <th>By type</th>
              <th style={{ width: 90 }}>Charged</th>
              <th style={{ width: 90 }}>Cost</th>
              <th style={{ width: "30%" }} />
            </tr>
          </thead>
          <tbody>
            {CATEGORIES.map((c) => (
              <tr key={c}>
                <td>{CATEGORY_LABELS[c]}</td>
                <td>{spend.byCategory[c].count.toLocaleString()}</td>
                <td>{usd(spend.byCategory[c].cost)}</td>
                <td>
                  <Share value={spend.byCategory[c].cost} total={spend.total} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <table>
          <thead>
            <tr>
              <th>By what sent it</th>
              <th style={{ width: 90 }}>Sent</th>
              <th style={{ width: 90 }}>Cost</th>
              <th style={{ width: "30%" }} />
            </tr>
          </thead>
          <tbody>
            {Object.entries(spend.bySource)
              .sort((a, b) => b[1].cost - a[1].cost)
              .map(([k, v]) => (
                <tr key={k}>
                  <td>{SOURCE_LABELS[k] ?? k}</td>
                  <td>{v.count.toLocaleString()}</td>
                  <td>{usd(v.cost)}</td>
                  <td>
                    <Share value={v.cost} total={spend.total} />
                  </td>
                </tr>
              ))}
            {Object.keys(spend.bySource).length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  No messages sent this month yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!compact && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
            <table>
              <thead>
                <tr>
                  <th>Free messages</th>
                  <th style={{ width: 90 }}>Count</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>After a Click-to-WhatsApp ad (72 h free)</td>
                  <td>{spend.free.entryPoint.toLocaleString()}</td>
                </tr>
                <tr>
                  <td>Utility inside the 24 h window</td>
                  <td>{spend.free.customerService.toLocaleString()}</td>
                </tr>
                <tr>
                  <td>Meta&apos;s 1,000 free bot replies this month</td>
                  <td>{spend.free.allowance.toLocaleString()}</td>
                </tr>
                {spend.free.other > 0 && (
                  <tr>
                    <td>Other free</td>
                    <td>{spend.free.other.toLocaleString()}</td>
                  </tr>
                )}
                {spend.failed > 0 && (
                  <tr>
                    <td className="muted">Failed (not charged)</td>
                    <td className="muted">{spend.failed.toLocaleString()}</td>
                  </tr>
                )}
              </tbody>
            </table>
            <table>
              <thead>
                <tr>
                  <th>By country</th>
                  <th style={{ width: 90 }}>Sent</th>
                  <th style={{ width: 90 }}>Cost</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(spend.byMarket)
                  .sort((a, b) => b[1].cost - a[1].cost)
                  .map(([k, v]) => (
                    <tr key={k}>
                      <td>{MARKET_LABELS[k as Market] ?? k}</td>
                      <td>{v.count.toLocaleString()}</td>
                      <td>{usd(v.cost)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          <table style={{ marginTop: 16 }}>
            <thead>
              <tr>
                <th>Templates by cost</th>
                <th style={{ width: 90 }}>Sent</th>
                <th style={{ width: 90 }}>Cost</th>
                <th style={{ width: 120 }}>Per message</th>
              </tr>
            </thead>
            <tbody>
              {spend.byTemplate.slice(0, 10).map((t) => (
                <tr key={t.name}>
                  <td>
                    <code>{t.name}</code>
                  </td>
                  <td>{t.count.toLocaleString()}</td>
                  <td>{usd(t.cost)}</td>
                  <td>{t.count ? `$${(t.cost / t.count).toFixed(4)}` : "—"}</td>
                </tr>
              ))}
              {spend.byTemplate.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No templates sent this month.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <DailyBars m={m} />
        </>
      )}
    </div>
  );
}

function DailyBars({ m }: { m: MonthSpend }) {
  const days: { key: string; n: number }[] = [];
  for (let t = m.start.getTime() + 4 * 3600_000; t < m.end.getTime() + 4 * 3600_000; t += 86400_000) {
    const key = new Date(t).toISOString().slice(0, 10);
    days.push({ key, n: m.spend.byDay[key] ?? 0 });
  }
  const top = Math.max(...days.map((d) => d.n), 0.01);
  return (
    <div style={{ marginTop: 16 }}>
      <strong style={{ fontSize: 13 }}>Daily spend</strong>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 80, marginTop: 6 }}>
        {days.map((d) => (
          <div
            key={d.key}
            title={`${d.key}: $${d.n.toFixed(2)}`}
            style={{ flex: 1, height: `${Math.max(d.n > 0 ? 3 : 1, (d.n / top) * 100)}%`, background: d.n > 0 ? "var(--a-brand)" : "var(--a-line)", borderRadius: 2 }}
          />
        ))}
      </div>
      <div className="muted" style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
        <span>{days[0]?.key.slice(8)}</span>
        <span>{days.at(-1)?.key.slice(8)}</span>
      </div>
    </div>
  );
}
