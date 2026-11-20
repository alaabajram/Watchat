// Viewer detail for support: progress, wallet, purchases, consent history, devices, messages.

import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash } from "@/components/admin/Flash";
import { can, requireAdmin } from "@/lib/admin/auth";
import { db } from "@/lib/supabase";
import { anonymiseViewerAction, grantCoinsAction, resendLinkAction, signOutViewerAction } from "../../../people-actions";

export const dynamic = "force-dynamic";

export default async function ViewerDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string; reveal?: string }> }) {
  const admin = await requireAdmin("viewers");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();

  const { data: v } = await db().from("viewers").select("*").eq("id", id).eq("tenant_id", admin.tenantId).maybeSingle();
  if (!v) notFound();

  const [{ data: balance }, { data: ledger }, { data: orders }, { data: optIns }, { data: sessions }, { data: progress }, { data: messages }, { data: passes }] =
    await Promise.all([
      db().rpc("wallet_balance", { p_viewer: id }),
      db().from("wallet_ledger").select("*").eq("viewer_id", id).order("created_at", { ascending: false }).limit(30),
      db().from("orders").select("*").eq("viewer_id", id).order("created_at", { ascending: false }).limit(20),
      db().from("opt_ins").select("*").eq("viewer_id", id).order("created_at", { ascending: false }).limit(10),
      db().from("sessions").select("id, user_agent, created_at, last_seen_at, trusted_at, revoked_at").eq("viewer_id", id).order("created_at", { ascending: false }).limit(10),
      db().from("progress").select("completed_at, updated_at, episodes!inner(number, series!inner(code))").eq("viewer_id", id).order("updated_at", { ascending: false }).limit(200),
      db().from("wa_messages").select("kind, template_name, category, status, error, created_at").eq("viewer_id", id).order("created_at", { ascending: false }).limit(15),
      db().from("entitlements").select("episode_number, source, series!inner(code)").eq("viewer_id", id),
    ]);

  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dubai" });
  const bySeries = new Map<string, { last: number; done: number }>();
  for (const p of (progress ?? []) as unknown as { completed_at: string | null; episodes: { number: number; series: { code: string } } }[]) {
    const code = p.episodes.series.code;
    const cur = bySeries.get(code) ?? { last: 0, done: 0 };
    cur.last = Math.max(cur.last, p.episodes.number);
    if (p.completed_at) cur.done++;
    bySeries.set(code, cur);
  }
  const phone = sp.reveal === "1" ? v.phone_e164 : v.phone_e164.length > 6 ? `${v.phone_e164.slice(0, 6)} ••• ${v.phone_e164.slice(-2)}` : v.phone_e164;
  const optIn = optIns?.[0]?.status ?? "never asked";

  return (
    <>
      <p>
        <Link href="/admin/viewers">← Viewers</Link>
      </p>
      <h1>
        {phone}{" "}
        {sp.reveal !== "1" && v.phone_e164 !== "deleted" && (
          <a href={`?reveal=1`} style={{ fontSize: 13 }}>
            show full number
          </a>
        )}
      </h1>
      <Flash ok={sp.ok} err={sp.err} />

      <div className="kpis">
        <div className="kpi">
          <span className="muted">Coins</span>
          <strong>🪙 {Number(balance ?? 0)}</strong>
        </div>
        <div className="kpi">
          <span className="muted">Alerts</span>
          <strong>{optIn}</strong>
        </div>
        <div className="kpi">
          <span className="muted">Country · language</span>
          <strong>
            {v.country ?? "—"} · {v.language === "ar_en_subs" ? "EN subs" : "AR"}
          </strong>
        </div>
        <div className="kpi">
          <span className="muted">Last seen</span>
          <strong style={{ fontSize: 16 }}>{fmt.format(new Date(v.last_seen_at))}</strong>
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Progress</h2>
          <table>
            <tbody>
              {[...bySeries.entries()].map(([code, s]) => (
                <tr key={code}>
                  <td>{code}</td>
                  <td>reached episode {s.last}</td>
                  <td className="muted">{s.done} completed</td>
                </tr>
              ))}
              {(passes ?? []).length > 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    Unlocked:{" "}
                    {(passes as unknown as { episode_number: number | null; source: string; series: { code: string } }[])
                      .map((p) => `${p.series.code} ${p.episode_number ?? "season pass"} (${p.source})`)
                      .join(", ")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Support actions</h2>
          {can(admin, "grantCoins") && (
            <form action={grantCoinsAction} className="row" style={{ marginBottom: 8 }}>
              <input type="hidden" name="id" value={id} />
              <input name="coins" type="number" min={1} max={10000} placeholder="Coins" style={{ width: 90 }} required />
              <input name="note" placeholder="Reason / ticket #" required />
              <button type="submit">Grant coins</button>
            </form>
          )}
          <div className="row">
            <form action={resendLinkAction}>
              <input type="hidden" name="id" value={id} />
              <button type="submit" className="secondary">
                Send player link in WhatsApp
              </button>
            </form>
            <form action={signOutViewerAction}>
              <input type="hidden" name="id" value={id} />
              <button type="submit" className="secondary">
                Sign out all devices
              </button>
            </form>
          </div>
          <form action={anonymiseViewerAction} className="row" style={{ marginTop: 12 }}>
            <input type="hidden" name="id" value={id} />
            <input name="confirm" placeholder='Type DELETE' style={{ width: 110 }} />
            <button type="submit" className="danger">
              Delete personal data
            </button>
          </form>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Wallet history</h2>
        <table>
          <tbody>
            {(ledger ?? []).map((l) => (
              <tr key={l.id}>
                <td>{fmt.format(new Date(l.created_at))}</td>
                <td>{l.reason}</td>
                <td>
                  <strong>{l.delta > 0 ? `+${l.delta}` : l.delta}</strong>
                </td>
                <td className="muted">{l.ref_id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid2">
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Orders</h2>
          <table>
            <tbody>
              {(orders ?? []).map((o) => (
                <tr key={o.id}>
                  <td>{fmt.format(new Date(o.created_at))}</td>
                  <td>{o.item_type}</td>
                  <td>
                    {o.currency} {Number(o.amount).toFixed(2)}
                  </td>
                  <td>
                    <span className={`badge ${o.status === "paid" ? "sent" : o.status}`}>{o.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Devices</h2>
          <table>
            <tbody>
              {(sessions ?? []).map((s) => (
                <tr key={s.id}>
                  <td className="muted">{(s.user_agent ?? "").slice(0, 40)}</td>
                  <td>{fmt.format(new Date(s.last_seen_at))}</td>
                  <td>{s.revoked_at ? "signed out" : s.trusted_at ? "trusted" : "watch only"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Alerts consent history</h2>
          <table>
            <tbody>
              {(optIns ?? []).map((o) => (
                <tr key={o.id}>
                  <td>{fmt.format(new Date(o.created_at))}</td>
                  <td>{o.status}</td>
                  <td className="muted">{o.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Recent WhatsApp messages</h2>
          <table>
            <tbody>
              {(messages ?? []).map((m, i) => (
                <tr key={i}>
                  <td>{fmt.format(new Date(m.created_at))}</td>
                  <td>{m.template_name ?? m.kind}</td>
                  <td>
                    <span className={`badge ${m.status}`}>{m.status}</span>
                    {m.error && <div className="muted">{m.error}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
