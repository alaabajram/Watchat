// Server side of the spend meter: loads a month's message counts, settings and revenue.

import { db } from "../supabase";
import { computeSpend, gulfMonth, meterLevel, mergeRates, projectMonth, USD_PER, type MeterLevel, type Rates, type SpendGroup, type SpendSummary } from "./meter";

export type SpendSettings = { budget: number | null; alertPct: number; stopMarketing: boolean; rates: Rates; ratesOverridden: boolean };

export async function getSpendSettings(tenantId: string): Promise<SpendSettings> {
  const { data } = await db().from("spend_settings").select("monthly_budget_usd, alert_pct, stop_marketing_at_budget, rates").eq("tenant_id", tenantId).maybeSingle();
  return {
    budget: data?.monthly_budget_usd == null ? null : Number(data.monthly_budget_usd),
    alertPct: data?.alert_pct ?? 80,
    stopMarketing: data?.stop_marketing_at_budget ?? false,
    rates: mergeRates(data?.rates),
    ratesOverridden: Boolean(data?.rates),
  };
}

export type MonthSpend = {
  label: string;
  start: Date;
  end: Date;
  spend: SpendSummary;
  projected: number;
  revenueUsd: number; // paid orders, excluding VAT
  level: MeterLevel;
  settings: SpendSettings;
};

/** This month (offset 0) or an earlier one (-1, -2…), in Gulf time. */
export async function loadMonthSpend(tenantId: string, offsetMonths = 0, now = new Date()): Promise<MonthSpend> {
  const { start, end, label } = gulfMonth(now, offsetMonths);
  const [settings, { data: groups, error }, { data: orders }] = await Promise.all([
    getSpendSettings(tenantId),
    db().rpc("wa_spend_groups", { p_tenant: tenantId, p_since: start.toISOString(), p_until: end.toISOString() }),
    db()
      .from("orders")
      .select("amount, vat_amount, currency, viewers!inner(tenant_id)")
      .eq("status", "paid")
      .eq("viewers.tenant_id", tenantId)
      .gte("paid_at", start.toISOString())
      .lt("paid_at", end.toISOString()),
  ]);
  if (error) throw new Error(`spend groups failed: ${error.message}`);
  const spend = computeSpend((groups ?? []) as SpendGroup[], settings.rates);
  const revenueUsd = (orders ?? []).reduce((sum, o) => sum + (Number(o.amount) - Number(o.vat_amount ?? 0)) * (USD_PER[o.currency as "AED" | "SAR"] ?? 0), 0);
  const projected = offsetMonths === 0 ? projectMonth(spend.total, now, start, end) : spend.total;
  return { label, start, end, spend, projected, revenueUsd, level: meterLevel(spend.total, settings.budget, settings.alertPct), settings };
}

// Marketing sends check the budget; the answer is kept for a few minutes so a campaign doesn't recount per message.
const budgetCache = new Map<string, { at: number; reached: boolean }>();
const BUDGET_CACHE_MS = 5 * 60_000;

/** True when "stop marketing at the budget" is on and this month's spend has reached the budget. */
export async function marketingBudgetReached(tenantId: string): Promise<boolean> {
  const hit = budgetCache.get(tenantId);
  if (hit && Date.now() - hit.at < BUDGET_CACHE_MS) return hit.reached;
  let reached = false;
  try {
    const settings = await getSpendSettings(tenantId);
    if (settings.stopMarketing && settings.budget) {
      const m = await loadMonthSpend(tenantId);
      reached = m.spend.total >= settings.budget;
    }
  } catch {
    reached = false; // never block sends because the meter couldn't be read
  }
  budgetCache.set(tenantId, { at: Date.now(), reached });
  return reached;
}

export function clearBudgetCache(tenantId: string) {
  budgetCache.delete(tenantId);
}
