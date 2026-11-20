// Spend: the WhatsApp spend meter in full, earlier months, and the budget and rate settings.

import { Flash } from "@/components/admin/Flash";
import { SpendMeter } from "@/components/admin/SpendMeter";
import { can, requireAdmin } from "@/lib/admin/auth";
import { CATEGORIES, DEFAULT_RATES, MARKET_LABELS, MARKETS } from "@/lib/spend/meter";
import { loadMonthSpend } from "@/lib/spend/store";
import { saveSpendSettingsAction } from "../../spend-actions";

export const dynamic = "force-dynamic";

export default async function SpendPage({ searchParams }: { searchParams: Promise<{ month?: string; ok?: string; err?: string }> }) {
  const admin = await requireAdmin("spend");
  const sp = await searchParams;
  const offset = [0, -1, -2, -3, -4, -5].includes(Number(sp.month)) ? Number(sp.month) : 0;
  const [m, ...previous] = await Promise.all([loadMonthSpend(admin.tenantId, offset), ...[-1, -2].map((o) => loadMonthSpend(admin.tenantId, offset + o))]);
  const editable = can(admin, "pricing");
  const s = m.settings;

  return (
    <>
      <h1>Spend</h1>
      <Flash ok={sp.ok} err={sp.err} />
      <form className="row card" method="get">
        <label>
          Month
          <select name="month" defaultValue={String(offset)}>
            <option value="0">This month</option>
            <option value="-1">Last month</option>
            <option value="-2">2 months ago</option>
            <option value="-3">3 months ago</option>
            <option value="-4">4 months ago</option>
            <option value="-5">5 months ago</option>
          </select>
        </label>
        <button type="submit" style={{ alignSelf: "end" }}>
          Show
        </button>
      </form>

      <SpendMeter m={m} />

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Month by month</h2>
        <table>
          <thead>
            <tr>
              <th>Month</th>
              <th>WhatsApp spend</th>
              <th>Revenue (excl. VAT)</th>
              <th>Share of revenue</th>
              <th>Charged messages</th>
            </tr>
          </thead>
          <tbody>
            {[m, ...previous].map((x) => (
              <tr key={x.label}>
                <td>{x.label}</td>
                <td>${x.spend.total.toFixed(2)}</td>
                <td>${x.revenueUsd.toFixed(2)}</td>
                <td>{x.revenueUsd > 0 ? `${Math.round((x.spend.total / x.revenueUsd) * 100)}%` : "—"}</td>
                <td>{x.spend.charged.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ marginBottom: 0, fontSize: 12 }}>
          Costs are worked out from Meta&apos;s rate card per message, using Meta&apos;s own verdict on each message (charged, free after an ad, free in the
          service window). Meta&apos;s invoice is the final word; small differences come from currency and timing.
        </p>
      </div>

      <form action={saveSpendSettingsAction} className="card">
        <h2 style={{ marginTop: 0 }}>Budget</h2>
        {!editable && <p className="muted">Only owners and finance can change these.</p>}
        <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="row">
            <label>
              Monthly WhatsApp budget (USD)
              <input name="budget" type="number" min={0} step="1" defaultValue={s.budget ?? ""} placeholder="No budget" />
            </label>
            <label>
              Warn at (% of budget)
              <input name="alert_pct" type="number" min={10} max={100} defaultValue={s.alertPct} />
            </label>
          </div>
          <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <input type="checkbox" name="stop_marketing" defaultChecked={s.stopMarketing} style={{ width: "auto" }} />
            Pause marketing templates (reminders, campaigns, growth agent) once the budget is reached. Bot replies and receipts keep working.
          </label>

          <details>
            <summary>Rates per message (USD) {s.ratesOverridden ? "· some changed from Meta's defaults" : "· Meta's rates from 1 Oct 2026"}</summary>
            <table style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>Market</th>
                  {CATEGORIES.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MARKETS.map((mk) => (
                  <tr key={mk}>
                    <td>{MARKET_LABELS[mk]}</td>
                    {CATEGORIES.map((c) => (
                      <td key={c}>
                        <input
                          name={`rate.${mk}.${c}`}
                          type="number"
                          min={0}
                          step="0.00001"
                          defaultValue={s.rates[mk][c]}
                          title={`Meta default: ${DEFAULT_RATES[mk][c]}`}
                          style={{ width: 100 }}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted" style={{ fontSize: 12 }}>
              Change a rate when Meta updates its rate card or your provider charges differently. Past months are recosted with the new rates.
            </p>
          </details>
          <div>
            <button type="submit">Save</button>
          </div>
        </fieldset>
      </form>
    </>
  );
}
