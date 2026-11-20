"use server";

import { audit, requireAdmin } from "@/lib/admin/auth";
import { bool, done, int, str, uuid } from "@/lib/admin/forms";
import { autopilotReadiness } from "@/lib/growth/agent";
import { executeSuggestion, rejectSuggestion, reviewStats, runGrowth } from "@/lib/growth/run";
import { allow } from "@/lib/security/rate-limit";
import { db } from "@/lib/supabase";

const BACK = "/admin/growth";

export async function saveGrowthSettingsAction(fd: FormData) {
  const admin = await requireAdmin("growth");
  let mode = str(fd, "mode", 20) === "autopilot" ? "autopilot" : "suggest";
  if (mode === "autopilot") {
    const s = await reviewStats(admin.tenantId);
    const r = autopilotReadiness(s.reviewed, s.approved);
    if (!r.ready) mode = "suggest";
  }
  const row = {
    tenant_id: admin.tenantId,
    enabled: bool(fd, "enabled"),
    mode,
    daily_limit: Math.min(1000, Math.max(1, int(fd, "daily_limit", 50))),
    min_inactive_days: Math.min(30, Math.max(1, int(fd, "min_inactive_days", 2))),
    holdout_pct: Math.min(50, Math.max(0, int(fd, "holdout_pct", 10))),
    run_hour: Math.min(21, Math.max(9, int(fd, "run_hour", 11))),
    updated_by: admin.id,
    updated_at: new Date().toISOString(),
  };
  const { error } = await db().from("growth_settings").upsert(row, { onConflict: "tenant_id" });
  if (error) done(BACK, `Save failed: ${error.message}`, "err");
  await audit(admin, "growth.settings_saved", "growth", null, row);
  done(BACK, mode !== str(fd, "mode", 20) ? "Saved. Autopilot stays locked until the agent has earned it." : "Saved.");
}

export async function runGrowthNowAction() {
  const admin = await requireAdmin("growth");
  if (!(await allow(`growth-run:${admin.tenantId}`, 3, 3600))) done(BACK, "The agent can run at most 3 times an hour.", "err");
  const r = await runGrowth(admin.tenantId, { force: true, adminId: admin.id });
  await audit(admin, "growth.run", "growth", null, r);
  if (r.error && !r.reviewed) done(BACK, r.error, "err");
  done(
    BACK,
    `Reviewed ${r.reviewed} viewers: ${r.suggestions} suggestions for you, ${r.none} best left alone, ${r.holdout} in the holdout group${r.sent ? `, ${r.sent} sent on autopilot` : ""}.${r.error ? ` Stopped early: ${r.error}` : ""}`,
  );
}

export async function approveSuggestionAction(fd: FormData) {
  const admin = await requireAdmin("growth");
  const id = uuid(fd, "id");
  if (!id) done(BACK, "Bad request.", "err");
  const r = await executeSuggestion(admin.tenantId, id!, admin.id);
  await audit(admin, "growth.approved", "growth_suggestion", id, { sent: r.ok });
  done(BACK, r.message, r.ok ? "ok" : "err");
}

export async function rejectSuggestionAction(fd: FormData) {
  const admin = await requireAdmin("growth");
  const id = uuid(fd, "id");
  if (!id) done(BACK, "Bad request.", "err");
  await rejectSuggestion(admin.tenantId, id!, admin.id, str(fd, "note", 300));
  await audit(admin, "growth.rejected", "growth_suggestion", id);
  done(BACK, "Rejected. The agent learns from your note on its next run.");
}
