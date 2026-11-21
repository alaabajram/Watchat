// Sequence flows: follow-ups we send first (approved templates only), each built on the flow builder canvas:
// Trigger (stopped mid-series / inactive / finished a series) → Wait / Condition / Template → End.

import Link from "next/link";
import { Flash } from "@/components/admin/Flash";
import { FlowTabs } from "@/components/admin/FlowTabs";
import { can, requireAdmin } from "@/lib/admin/auth";
import { sanitizeGraph } from "@/lib/flows/sanitize";
import { SEQUENCE_TRIGGERS } from "@/lib/flows/types";
import { templateNamesIn } from "@/lib/flows/validate";
import { db } from "@/lib/supabase";
import { createSequence, deleteSequence, setSequenceActive } from "../../sequence-actions";

export const dynamic = "force-dynamic";

const delayText = (h: number) => (h % 24 === 0 ? `${h / 24} day${h === 24 ? "" : "s"}` : `${h} hour${h === 1 ? "" : "s"}`);

export default async function SequencesPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const admin = await requireAdmin("messaging");
  const sp = await searchParams;
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const [{ data: seqs }, { data: series }, { data: runs }, { data: sent }, { data: approved }] = await Promise.all([
    db().from("sequences").select("id, name, trigger, delay_hours, series_id, active, graph, draft, version, template_name, published_at").eq("tenant_id", admin.tenantId).order("created_at"),
    db().from("series").select("id, code").eq("tenant_id", admin.tenantId),
    db().from("sequence_runs").select("sequence_id, status").eq("tenant_id", admin.tenantId).in("status", ["wait", "running"]),
    db().from("wa_messages").select("ref_id, status").eq("source", "sequence").neq("status", "failed").gte("created_at", since),
    db().from("wa_templates").select("name").eq("tenant_id", admin.tenantId).eq("meta_status", "APPROVED"),
  ]);
  const codeById = new Map((series ?? []).map((s) => [s.id as string, s.code as string]));
  const approvedNames = new Set((approved ?? []).map((t) => t.name as string));
  const count = (list: { [k: string]: unknown }[] | null, key: string, id: string) => (list ?? []).filter((r) => r[key] === id).length;
  const canEdit = can(admin, "messaging");

  return (
    <>
      <FlowTabs current="sequences" />
      <Flash ok={sp.ok} err={sp.err} />
      <div className="card">
        <p style={{ marginTop: 0 }}>
          Sequences bring viewers back. They start at a <strong>Trigger</strong> (stopped in the middle of a series, inactive, or finished a series),
          then you chain <strong>Waits</strong>, <strong>Conditions</strong> (e.g. &quot;came back?&quot;) and <strong>Templates</strong> on the canvas.
        </p>
        <p className="muted" style={{ marginBottom: 0 }}>
          WhatsApp only allows approved templates when we message first. Create a template right on a Template card: it&apos;s saved to WhatsApp templates
          and sent to Meta for approval, and the sequence starts once every template in it is approved. Only viewers with alerts on are included,
          nothing goes out between 22:00 and 09:00 Gulf time, and each viewer gets at most one marketing message every 20 hours.
        </p>
      </div>

      {canEdit && (
        <form action={createSequence} className="card row">
          <label style={{ flex: 1 }}>
            New sequence
            <input name="name" placeholder="e.g. Bring back viewers who stopped mid-series" maxLength={80} required dir="auto" />
          </label>
          <button type="submit">Create & open the builder</button>
        </form>
      )}

      {(seqs ?? []).length === 0 ? (
        <p className="muted">No sequences yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Sequence</th>
              <th>Starts when</th>
              <th>Status</th>
              <th>In it now</th>
              <th>Sent (30 days)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(seqs ?? []).map((s) => {
              const g = sanitizeGraph(s.graph);
              const trigger = SEQUENCE_TRIGGERS.find((t) => t.value === s.trigger)?.label ?? s.trigger;
              const names = g ? templateNamesIn(g) : s.template_name ? [s.template_name as string] : [];
              const pending = names.filter((n) => !approvedNames.has(n));
              const status = !g && !s.template_name ? "Draft" : s.active ? (pending.length ? "On · waiting for Meta" : "On") : "Paused";
              return (
                <tr key={s.id}>
                  <td>
                    <strong dir="auto">{s.name}</strong>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {g ? `Version ${s.version} · ${g.nodes.length} cards · ${names.length} template${names.length === 1 ? "" : "s"}` : s.template_name ? `Single template: ${s.template_name}` : "Not published yet"}
                    </div>
                  </td>
                  <td>
                    {trigger} · after {delayText(s.delay_hours as number)}
                    <div className="muted" style={{ fontSize: 12 }}>{s.series_id ? codeById.get(s.series_id as string) : "Any series"}</div>
                  </td>
                  <td>
                    <span className={`badge ${status.startsWith("On") ? (pending.length ? "PENDING" : "on") : status === "Paused" ? "off" : "draft"}`}>{status}</span>
                    {pending.length > 0 && <div className="muted" style={{ fontSize: 12 }}>Waiting: {pending.join(", ")}</div>}
                  </td>
                  <td>{count(runs as { [k: string]: unknown }[] | null, "sequence_id", s.id as string)}</td>
                  <td>{count(sent as { [k: string]: unknown }[] | null, "ref_id", s.id as string)}</td>
                  <td>
                    <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                      <Link className="abtn" href={`/admin/flows/sequence/${s.id}`}>
                        Open builder
                      </Link>
                      {canEdit && (g || s.template_name) && (
                        <form action={setSequenceActive}>
                          <input type="hidden" name="id" value={s.id} />
                          <input type="hidden" name="active" value={s.active ? "0" : "1"} />
                          <button type="submit" className="secondary">
                            {s.active ? "Pause" : "Turn on"}
                          </button>
                        </form>
                      )}
                      {canEdit && (
                        <form action={deleteSequence}>
                          <input type="hidden" name="id" value={s.id} />
                          <button type="submit" className="secondary" style={{ color: "var(--a-coral-text)" }}>
                            Delete
                          </button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
