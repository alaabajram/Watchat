// Flow builder home: each series' chat flow with its draft / live status. A series runs one flow for WhatsApp +
// Telegram, or a WhatsApp + Telegram pair; the tabs show what runs on each app.

import Link from "next/link";
import { ChannelTabs, appFilter } from "@/components/admin/ChannelTabs";
import { CtrMeter } from "@/components/admin/CtrMeter";
import { FlowTabs } from "@/components/admin/FlowTabs";
import { ChannelBadge } from "@/components/flow/ChannelBar";
import { requireAdmin } from "@/lib/admin/auth";
import { flowSummary } from "@/lib/ctr/ctr";
import { CTR_DAYS, loadFlowCtr, loadFlowCtrByChannel } from "@/lib/ctr/store";
import { channelStats } from "@/lib/flows/store";
import { CARD_LABELS, runsFor, type FlowChannel, type FlowGraph } from "@/lib/flows/types";
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type Row = { seriesId: string; code: string; titleEn: string; titleAr: string; status: string; channel: FlowChannel; split: boolean; versionId: string | null };

export default async function FlowsPage({ searchParams }: { searchParams: Promise<{ app?: string }> }) {
  const admin = await requireAdmin("bot");
  const app = appFilter((await searchParams).app);
  const [{ data: series }, { data: flows }, { data: versions }, { data: running }, ctr, byChannel] = await Promise.all([
    db().from("series").select("id, code, title_en, title_ar, status").eq("tenant_id", admin.tenantId).order("created_at"),
    db().from("flows").select("series_id, published_version_id, draft_updated_at, channel").eq("tenant_id", admin.tenantId),
    db().from("flow_versions").select("id, version, published_at, graph").eq("tenant_id", admin.tenantId),
    db().from("flow_runs").select("series_id, status").eq("tenant_id", admin.tenantId).in("status", ["input", "wait"]),
    loadFlowCtr(admin.tenantId).catch(() => ({}) as Awaited<ReturnType<typeof loadFlowCtr>>),
    loadFlowCtrByChannel(admin.tenantId).catch(() => ({}) as Awaited<ReturnType<typeof loadFlowCtrByChannel>>),
  ]);
  const versionBy = new Map((versions ?? []).map((v) => [v.id, v]));
  const activeBy = new Map<string, { input: number; wait: number }>();
  for (const r of running ?? []) {
    const a = activeBy.get(r.series_id) ?? { input: 0, wait: 0 };
    a[r.status as "input" | "wait"]++;
    activeBy.set(r.series_id, a);
  }
  // One row per flow; a series without a flow yet runs the standard flow for both apps.
  const rows: Row[] = (series ?? []).flatMap((s) => {
    const own = (flows ?? []).filter((f) => f.series_id === s.id);
    const split = own.some((f) => f.channel === "telegram");
    const base = { seriesId: s.id as string, code: s.code as string, titleEn: s.title_en as string, titleAr: s.title_ar as string, status: s.status as string, split };
    if (!own.length) return [{ ...base, channel: "both" as FlowChannel, versionId: null }];
    return own
      .sort((a, b) => (a.channel === "telegram" ? 1 : 0) - (b.channel === "telegram" ? 1 : 0))
      .map((f) => ({ ...base, channel: f.channel as FlowChannel, versionId: (f.published_version_id as string | null) ?? null }));
  });
  const shown = rows.filter((r) => app === "all" || runsFor(r.channel, app));
  const counts = { all: rows.length, whatsapp: rows.filter((r) => runsFor(r.channel, "whatsapp")).length, telegram: rows.filter((r) => runsFor(r.channel, "telegram")).length };

  return (
    <>
      <FlowTabs current="series" />
      <div className="card">
        <p style={{ marginTop: 0 }}>
          Each series has its own chat flow: drag cards onto a canvas, connect buttons to the next card, and watch the chat preview update as you go.
          One flow runs on <strong>WhatsApp + Telegram</strong>; when a series needs something different on Telegram (it&apos;s free to message there),
          open its builder and choose <em>Separate Telegram flow</em> — the series then has a WhatsApp flow and a Telegram flow, edited separately.
        </p>
        <p className="muted" style={{ marginBottom: 0 }}>
          A series without a published flow gets the standard flow, published automatically on its first chat. Publishing affects new chats; viewers
          already in the flow continue on the version they started.
        </p>
      </div>
      <ChannelTabs base="/admin/flows" current={app} counts={counts} />
      <table className="card">
        <thead>
          <tr>
            <th>Series</th>
            <th>Runs on</th>
            <th>Status</th>
            <th>Flow</th>
            <th>Viewers in flow</th>
            <th>CTR ({CTR_DAYS} days)</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => {
            const v = r.versionId ? versionBy.get(r.versionId) : null;
            const a = activeBy.get(r.seriesId);
            const stats = channelStats(ctr[r.seriesId] ?? {}, byChannel[r.seriesId] ?? {}, r.channel);
            const href = r.channel === "telegram" ? `/admin/flows/${r.seriesId}?channel=telegram` : `/admin/flows/${r.seriesId}`;
            return (
              <tr key={`${r.seriesId}:${r.channel}`}>
                <td>
                  <strong>{r.code}</strong> · {r.titleEn} <span dir="rtl">· {r.titleAr}</span>
                </td>
                <td>
                  <ChannelBadge channel={r.channel} />
                </td>
                <td>{r.status}</td>
                <td>{v ? `Live v${v.version}` : "Standard flow"}</td>
                <td>{a ? `${a.input} waiting for a tap · ${a.wait} waiting for time` : "—"}</td>
                <td>
                  {(() => {
                    const nodes = ((v?.graph as FlowGraph | undefined)?.nodes ?? []) as FlowGraph["nodes"];
                    const sum = flowSummary(stats, Object.fromEntries(nodes.map((n) => [n.id, n.data.kind])));
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
                  <Link className="btn" href={href}>
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
