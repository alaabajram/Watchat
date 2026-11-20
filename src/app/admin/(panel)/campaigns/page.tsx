// Campaigns: one-off WhatsApp broadcasts to a filtered group of opted-in viewers, with a cost estimate.

import { Flash } from "@/components/admin/Flash";
import { requireAdmin } from "@/lib/admin/auth";
import { db } from "@/lib/supabase";
import { cancelCampaignAction, saveCampaignAction, scheduleCampaignAction } from "../../messaging-actions";

export const dynamic = "force-dynamic";

function describe(segment: Record<string, unknown>, codes: Map<string, string>): string {
  const parts: string[] = [];
  if (segment.series_id) parts.push(`watched ${codes.get(String(segment.series_id)) ?? "series"}`);
  if (segment.language) parts.push(segment.language === "ar" ? "Arabic" : "English subtitles");
  if (segment.country) parts.push(String(segment.country));
  if (segment.paid === true) parts.push("has paid");
  if (segment.paid === false) parts.push("never paid");
  if (segment.inactive_days) parts.push(`inactive ${segment.inactive_days}+ days`);
  if (segment.active_within_days) parts.push(`active in last ${segment.active_within_days} days`);
  return parts.length ? parts.join(" · ") : "All opted-in viewers";
}

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const admin = await requireAdmin("messaging");
  const sp = await searchParams;
  const [{ data: campaigns }, { data: templates }, { data: series }] = await Promise.all([
    db().from("campaigns").select("*").eq("tenant_id", admin.tenantId).order("created_at", { ascending: false }).limit(50),
    db().from("wa_templates").select("name, meta_status").eq("tenant_id", admin.tenantId),
    db().from("series").select("id, code, title_en").eq("tenant_id", admin.tenantId).order("created_at"),
  ]);
  const codes = new Map((series ?? []).map((s) => [s.id as string, s.code as string]));
  const names = [...new Set((templates ?? []).map((t) => t.name))];
  const approved = new Set((templates ?? []).filter((t) => t.meta_status === "APPROVED").map((t) => t.name));
  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dubai" });

  return (
    <>
      <h1>Campaigns</h1>
      <Flash ok={sp.ok} err={sp.err} />
      <table className="card">
        <thead>
          <tr>
            <th>Campaign</th>
            <th>Audience</th>
            <th>Est. cost</th>
            <th>Status</th>
            <th>Sent / failed</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {(campaigns ?? []).map((c) => (
            <tr key={c.id}>
              <td>
                <strong>{c.name}</strong>
                <div className="muted">
                  <code>{c.template_name}</code>
                  {c.series_id && ` · promotes ${codes.get(c.series_id)}`}
                </div>
              </td>
              <td>
                {c.audience_count ?? "—"} viewers
                <div className="muted">{describe(c.segment ?? {}, codes)}</div>
              </td>
              <td>${Number(c.estimated_cost_usd ?? 0).toFixed(2)}</td>
              <td>
                <span className={`badge ${c.status}`}>{c.status}</span>
                {c.scheduled_at && <div className="muted">{fmt.format(new Date(c.scheduled_at))} GST</div>}
              </td>
              <td>
                {c.sent_count} / {c.failed_count}
              </td>
              <td>
                <div className="row">
                  {(c.status === "draft" || c.status === "scheduled") && (
                    <form action={scheduleCampaignAction} className="row">
                      <input type="hidden" name="id" value={c.id} />
                      <input type="datetime-local" name="scheduled_at" required />
                      <button type="submit">{c.status === "scheduled" ? "Reschedule" : "Schedule"}</button>
                    </form>
                  )}
                  {["draft", "scheduled", "sending"].includes(c.status) && (
                    <form action={cancelCampaignAction}>
                      <input type="hidden" name="id" value={c.id} />
                      <button type="submit" className="secondary">
                        Cancel
                      </button>
                    </form>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form action={saveCampaignAction} className="card">
        <h2 style={{ marginTop: 0 }}>New campaign</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Saving creates a draft and shows how many opted-in viewers match and the estimated WhatsApp cost. Schedule it after checking.
        </p>
        <div className="grid3">
          <label>
            Name
            <input name="name" placeholder="New series launch · DESERT02" required />
          </label>
          <label>
            Template
            <select name="template_name" required>
              <option value="">Choose…</option>
              {names.map((n) => (
                <option key={n} value={n}>
                  {n}
                  {approved.has(n) ? "" : " (not approved yet)"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Promoted series (title + link)
            <select name="series_id">
              <option value="">None</option>
              {(series ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} · {s.title_en}
                </option>
              ))}
            </select>
          </label>
        </div>
        <h2>Who gets it</h2>
        <div className="grid3">
          <label>
            Watched series
            <select name="seg_series_id">
              <option value="">Any</option>
              {(series ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code}
                </option>
              ))}
            </select>
          </label>
          <label>
            Language
            <select name="seg_language">
              <option value="">Any</option>
              <option value="ar">Arabic</option>
              <option value="ar_en_subs">English subtitles</option>
            </select>
          </label>
          <label>
            Country
            <select name="seg_country">
              <option value="">Any</option>
              <option value="AE">UAE</option>
              <option value="SA">Saudi Arabia</option>
              <option value="KW">Kuwait</option>
              <option value="QA">Qatar</option>
              <option value="BH">Bahrain</option>
              <option value="OM">Oman</option>
            </select>
          </label>
          <label>
            Payment
            <select name="seg_paid">
              <option value="">Any</option>
              <option value="true">Has paid</option>
              <option value="false">Never paid</option>
            </select>
          </label>
          <label>
            Inactive for at least (days)
            <input name="seg_inactive_days" type="number" min={0} placeholder="e.g. 14" />
          </label>
          <label>
            Active within the last (days)
            <input name="seg_active_within_days" type="number" min={0} placeholder="e.g. 30" />
          </label>
        </div>
        <p>
          <button type="submit">Save draft & count audience</button>
        </p>
      </form>
    </>
  );
}
