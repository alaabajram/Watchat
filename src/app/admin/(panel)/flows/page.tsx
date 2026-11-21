// Flow builder home: one flow per series, with its draft / live status.

import Link from "next/link";
import { CtrMeter } from "@/components/admin/CtrMeter";
import { FlowTabs } from "@/components/admin/FlowTabs";
import { requireAdmin } from "@/lib/admin/auth";
import { flowSummary } from "@/lib/ctr/ctr";
import { CTR_DAYS, loadFlowCtr } from "@/lib/ctr/store";
import { CARD_LABELS, type FlowGraph } from "@/lib/flows/types";
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function FlowsPage() {
  const admin = await requireAdmin("bot");
  const [{ data: series }, { data: flows }, { data: versions }, { data: running }, ctr] = await Promise.all([
    db().from("series").select("id, code, title_en, title_ar, status").eq("tenant_id", admin.tenantId).order("created_at"),
    db().from("flows").select("series_id, published_version_id, draft_updated_at").eq("tenant_id", admin.tenantId),
    db().from("flow_versions").select("id, version, published_at, graph").eq("tenant_id", admin.tenantId),
    db().from("flow_runs").select("series_id, status").eq("tenant_id", admin.tenantId).in("status", ["input", "wait"]),
    loadFlowCtr(admin.tenantId).catch(() => ({}) as Awaited<ReturnType<typeof loadFlowCtr>>),
  ]);
  const flowBy = new Map((flows ?? []).map((f) => [f.series_id, f]));
  const versionBy = new Map((versions ?? []).map((v) => [v.id, v]));
  const activeBy = new Map<string, { input: number; wait: number }>();
  for (const r of running ?? []) {
    const a = activeBy.get(r.series_id) ?? { input: 0, wait: 0 };
    a[r.status as "input" | "wait"]++;
    activeBy.set(r.series_id, a);
  }

  return (
    <>
      <FlowTabs current="series" />
      <div className="card">
        <p style={{ marginTop: 0 }}>
          Each series has its own chat flow: drag cards onto a canvas, connect buttons to the next card, and watch the WhatsApp preview update as you go. Upload
          video cuts and images to the series media library or straight onto a card.
        </p>
        <p className="muted" style={{ marginBottom: 0 }}>
          A series without a published flow gets the standard flow (language, trailer, chat episodes, web link, alerts), published automatically on its
          first chat. Publishing affects new chats; viewers already in the flow continue on the version they started.
        </p>
      </div>
      <table className="card">
        <thead>
          <tr>
            <th>Series</th>
            <th>Status</th>
            <th>Flow</th>
            <th>Viewers in flow</th>
            <th>CTR ({CTR_DAYS} days)</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {(series ?? []).map((s) => {
            const f = flowBy.get(s.id);
            const v = f?.published_version_id ? versionBy.get(f.published_version_id) : null;
            const a = activeBy.get(s.id);
            return (
              <tr key={s.id}>
                <td>
                  <strong>{s.code}</strong> · {s.title_en} <span dir="rtl">· {s.title_ar}</span>
                </td>
                <td>{s.status}</td>
                <td>{v ? `Live v${v.version}` : "Standard flow"}</td>
                <td>{a ? `${a.input} waiting for a tap · ${a.wait} waiting for time` : "—"}</td>
                <td>
                  {(() => {
                    const nodes = ((v?.graph as FlowGraph | undefined)?.nodes ?? []) as FlowGraph["nodes"];
                    const sum = flowSummary(ctr[s.id] ?? {}, Object.fromEntries(nodes.map((n) => [n.id, n.data.kind])));
                    if (!sum.reached) return <span className="muted">—</span>;
                    const weak = nodes.find((n) => n.id === sum.weakest);
                    return (
                      <>
                        <CtrMeter clicks={sum.clicked} base={sum.reached} kind="card" />
                        {weak && (
                          <div className="muted" style={{ fontSize: 12 }}>
                            Weakest card: {weak.name || CARD_LABELS[weak.data.kind].split(":")[0]}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </td>
                <td>
                  <Link className="btn" href={`/admin/flows/${s.id}`}>
                    Open builder
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
