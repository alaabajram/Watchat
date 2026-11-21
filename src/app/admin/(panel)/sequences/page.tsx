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
import { ChannelTabs, appFilter } from "@/components/admin/ChannelTabs";
import { ChannelBadge } from "@/components/flow/ChannelBar";
import { loadMessageCtrByChannel } from "@/lib/ctr/store";
import { CHANNEL_COLOR, runsFor, type FlowChannel } from "@/lib/flows/types";

export const dynamic = "force-dynamic";

const delayText = (h: number) => (h % 24 === 0 ? `${h / 24} day${h === 24 ? "" : "s"}` : `${h} hour${h === 1 ? "" : "s"}`);

export default async function SequencesPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; app?: string }> }) {
  const admin = await requireAdmin("messaging");
  const sp = await searchParams;
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const app = appFilter(sp.app);
  const [{ data: allSeqs }, { data: series }, { data: runs }, { data: sent }, { data: approved }, split] = await Promise.all([
    db().from("sequences").select("id, name, trigger, delay_hours, series_id, active, graph, draft, version, template_name, published_at, channel").eq("tenant_id", admin.tenantId).order("created_at"),
    db().from("series").select("id, code").eq("tenant_id", admin.tenantId),
    db().from("sequence_runs").select("sequence_id, status").eq("tenant_id", admin.tenantId).in("status", ["wait", "running"]),
    db().from("wa_messages").select("ref_id, status").eq("source", "sequence").neq("status", "failed").gte("created_at", since),
    db().from("wa_templates").select("name").eq("tenant_id", admin.tenantId).eq("meta_status", "APPROVED"),
    loadMessageCtrByChannel(admin.tenantId).catch(() => new Map() as Awaited<ReturnType<typeof loadMessageCtrByChannel>>),
  ]);
  const chOf = (s: { channel?: unknown }) => ((s.channel as FlowChannel | undefined) ?? "both");
  const seqs = (allSeqs ?? []).filter((s) => app === "all" || runsFor(chOf(s), app));
  const counts = {
    all: (allSeqs ?? []).length,
    whatsapp: (allSeqs ?? []).filter((s) => runsFor(chOf(s), "whatsapp")).length,
    telegram: (allSeqs ?? []).filter((s) => runsFor(chOf(s), "telegram")).length,
  };
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
          Each sequence runs for <strong>WhatsApp + Telegram</strong>, <strong>WhatsApp only</strong> or <strong>Telegram only</strong>. On WhatsApp we may
          only message first with approved templates (paid): create one right on a Template card and it&apos;s sent to Meta for approval; the sequence
          starts once every template in it is approved. On Telegram the same Template cards go out as free normal messages, so Telegram-only sequences
          don&apos;t wait for Meta. Only viewers with alerts on are included, nothing goes out between 22:00 and 09:00 Gulf time, and each viewer gets
          at most one marketing message every 20 hours.
        </p>
      </div>

      {canEdit && (
        <form action={createSequence} className="card row">
          <label style={{ flex: 1 }}>
            New sequence
            <input name="name" placeholder="e.g. Bring back viewers who stopped mid-series" maxLength={80} required dir="auto" />
          </label>
          <label>
            Runs for
            <select name="channel" defaultValue={app === "all" ? "both" : app}>
              <option value="both">WhatsApp + Telegram</option>
              <option value="whatsapp">WhatsApp only</option>
              <option value="telegram">Telegram only (free messages)</option>
            </select>
          </label>
          <button type="submit">Create & open the builder</button>
        </form>
      )}

      <ChannelTabs base="/admin/sequences" current={app} counts={counts} />
      {seqs.length === 0 ? (
        <p className="muted">No sequences yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Sequence</th>
              <th>Runs on</th>
              <th>Starts when</th>
              <th>Status</th>
              <th>In it now</th>
              <th>Sent (30 days)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {seqs.map((s) => {
              const g = sanitizeGraph(s.graph);
              const trigger = SEQUENCE_TRIGGERS.find((t) => t.value === s.trigger)?.label ?? s.trigger;
              const names = g ? templateNamesIn(g) : s.template_name ? [s.template_name as string] : [];
              // Telegram-only sequences send templates as free messages: no Meta approval to wait for.
              const pending = chOf(s) === "telegram" ? [] : names.filter((n) => !approvedNames.has(n));
              const perApp = split.get(`sequence:${s.id}`);
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
                    <ChannelBadge channel={chOf(s)} />
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
                  <td>
                    {count(sent as { [k: string]: unknown }[] | null, "ref_id", s.id as string)}
                    {perApp && (perApp.whatsapp || perApp.telegram) && (
                      <div style={{ fontSize: 12, display: "flex", gap: 8 }}>
                        {(["whatsapp", "telegram"] as const).map((c) =>
                          perApp[c] ? (
                            <span key={c} style={{ color: CHANNEL_COLOR[c], fontWeight: 600 }} title={`${perApp[c]!.clicked} of ${perApp[c]!.sent} opened the link`}>
                              {c === "whatsapp" ? "WA" : "TG"} {perApp[c]!.sent} · CTR {perApp[c]!.sent ? Math.round((perApp[c]!.clicked / perApp[c]!.sent) * 100) : 0}%
                            </span>
                          ) : null,
                        )}
                      </div>
                    )}
                  </td>
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
