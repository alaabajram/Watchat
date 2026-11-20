// Automated sequences: timed WhatsApp follow-ups to opted-in viewers.

import { Flash } from "@/components/admin/Flash";
import { requireAdmin } from "@/lib/admin/auth";
import { MARKETING_GAP_HOURS, QUIET_END_HOUR, QUIET_START_HOUR } from "@/lib/messaging/policy";
import { db } from "@/lib/supabase";
import { deleteSequenceAction, saveSequenceAction, toggleSequenceAction } from "../../messaging-actions";

export const dynamic = "force-dynamic";

const TRIGGER_LABEL: Record<string, string> = {
  stopped_mid_series: "Stopped mid-series (resume reminder)",
  inactive: "Inactive for a while (win-back)",
  finished_series: "Finished a series (suggest the next)",
};

export default async function SequencesPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; edit?: string }> }) {
  const admin = await requireAdmin("messaging");
  const sp = await searchParams;
  const since = new Date(Date.now() - 7 * 86400_000).toISOString();
  const [{ data: sequences }, { data: templates }, { data: series }, { data: sends }] = await Promise.all([
    db().from("sequences").select("*").eq("tenant_id", admin.tenantId).order("created_at"),
    db().from("wa_templates").select("name, meta_status").eq("tenant_id", admin.tenantId),
    db().from("series").select("id, code").eq("tenant_id", admin.tenantId),
    db().from("sequence_sends").select("sequence_id, status").gte("sent_at", since),
  ]);
  const templateNames = [...new Set((templates ?? []).map((t) => t.name))];
  const approved = new Set((templates ?? []).filter((t) => t.meta_status === "APPROVED").map((t) => t.name));
  const sentBy = (sends ?? []).reduce<Record<string, number>>((acc, s) => {
    if (s.status === "sent") acc[s.sequence_id] = (acc[s.sequence_id] ?? 0) + 1;
    return acc;
  }, {});
  const editing = (sequences ?? []).find((s) => s.id === sp.edit);

  return (
    <>
      <h1>Sequences</h1>
      <Flash ok={sp.ok} err={sp.err} />
      <div className="card muted">
        Sent automatically every 15 minutes to <strong>opted-in</strong> viewers only, never between {QUIET_START_HOUR}:00 and 0
        {QUIET_END_HOUR}:00 Gulf time, and at most one marketing message per viewer every {MARKETING_GAP_HOURS} hours. Each viewer gets
        each moment once.
      </div>
      <table className="card">
        <thead>
          <tr>
            <th>Name</th>
            <th>Trigger</th>
            <th>After</th>
            <th>Template</th>
            <th>Series</th>
            <th>Sent (7 days)</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {(sequences ?? []).map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td>{TRIGGER_LABEL[s.trigger]}</td>
              <td>{s.delay_hours} h</td>
              <td>
                <code>{s.template_name}</code>
                {!approved.has(s.template_name) && <div className="muted">⚠ not approved yet</div>}
              </td>
              <td>{(series ?? []).find((x) => x.id === s.series_id)?.code ?? "All"}</td>
              <td>{sentBy[s.id] ?? 0}</td>
              <td>
                <span className={`badge ${s.active ? "on" : "off"}`}>{s.active ? "active" : "paused"}</span>
              </td>
              <td>
                <div className="row">
                  <form action={toggleSequenceAction}>
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="active" value={String(!s.active)} />
                    <button type="submit" className="secondary">
                      {s.active ? "Pause" : "Activate"}
                    </button>
                  </form>
                  <a className="abtn secondary" href={`/admin/sequences?edit=${s.id}`}>
                    Edit
                  </a>
                  <form action={deleteSequenceAction}>
                    <input type="hidden" name="id" value={s.id} />
                    <button type="submit" className="secondary">
                      Delete
                    </button>
                  </form>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form action={saveSequenceAction} className="card" key={editing?.id ?? "new"}>
        <h2 style={{ marginTop: 0 }}>{editing ? `Edit "${editing.name}"` : "New sequence"}</h2>
        {editing && <input type="hidden" name="id" value={editing.id} />}
        <div className="grid3">
          <label>
            Name
            <input name="name" defaultValue={editing?.name ?? ""} placeholder="Resume after 24 h" required />
          </label>
          <label>
            Trigger
            <select name="trigger" defaultValue={editing?.trigger ?? "stopped_mid_series"}>
              {Object.entries(TRIGGER_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            Send after (hours)
            <input name="delay_hours" type="number" min={1} max={2160} defaultValue={editing?.delay_hours ?? 24} />
          </label>
          <label>
            Template
            <select name="template_name" defaultValue={editing?.template_name ?? ""} required>
              <option value="">Choose…</option>
              {templateNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                  {approved.has(n) ? "" : " (not approved yet)"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Series
            <select name="series_id" defaultValue={editing?.series_id ?? ""}>
              <option value="">All series</option>
              {(series ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code}
                </option>
              ))}
            </select>
          </label>
          <label className="inline" style={{ alignSelf: "end" }}>
            <input type="checkbox" name="active" defaultChecked={editing?.active ?? false} /> Active
          </label>
        </div>
        <p>
          <button type="submit">Save sequence</button>
        </p>
      </form>
    </>
  );
}
