"use server";

import { audit, requireAdmin } from "@/lib/admin/auth";
import { bool, done, int, num } from "@/lib/admin/forms";
import { CATEGORIES, DEFAULT_RATES, MARKETS } from "@/lib/spend/meter";
import { clearBudgetCache } from "@/lib/spend/store";
import { db } from "@/lib/supabase";

/** Budget, alert level, the marketing stop, and rate overrides. Owners and finance only. */
export async function saveSpendSettingsAction(fd: FormData) {
  const admin = await requireAdmin("pricing");
  const back = "/admin/spend";
  const budget = num(fd, "budget");
  if (budget != null && (budget < 0 || budget > 1_000_000)) done(back, "Budget must be between $0 and $1,000,000.", "err");
  const alertPct = Math.min(100, Math.max(10, int(fd, "alert_pct", 80)));

  // Only rates that differ from Meta's defaults are saved, so a later rate-card update reaches the rest.
  const overrides: Record<string, Record<string, number>> = {};
  for (const m of MARKETS) {
    for (const c of CATEGORIES) {
      const v = num(fd, `rate.${m}.${c}`);
      if (v == null) continue;
      if (v < 0 || v >= 5) done(back, `The ${m} ${c} rate looks wrong.`, "err");
      if (Math.abs(v - DEFAULT_RATES[m][c]) > 1e-9) (overrides[m] ??= {})[c] = v;
    }
  }

  const { error } = await db()
    .from("spend_settings")
    .upsert({
      tenant_id: admin.tenantId,
      monthly_budget_usd: budget,
      alert_pct: alertPct,
      stop_marketing_at_budget: bool(fd, "stop_marketing"),
      rates: Object.keys(overrides).length ? overrides : null,
      updated_by: admin.id,
      updated_at: new Date().toISOString(),
    });
  if (error) done(back, `Not saved: ${error.message}`, "err");
  clearBudgetCache(admin.tenantId);
  await audit(admin, "spend_settings.saved", "spend_settings", null, { budget, alertPct, overrides: Object.keys(overrides).length });
  done(back, "Saved.");
}
