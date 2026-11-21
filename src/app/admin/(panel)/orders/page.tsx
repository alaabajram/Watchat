// Orders & payments. While online payments are off, viewers request packs and get a reference (WC-XXXXX);
// the team collects cash or a transfer, then marks the order paid here — only then are coins added.

import Link from "next/link";
import { Flash } from "@/components/admin/Flash";
import { requireAdmin } from "@/lib/admin/auth";
import { db } from "@/lib/supabase";
import { paymentMode } from "@/lib/wallet";
import { approveOrderAction, cancelOrderAction, refundStarsAction } from "../../order-actions";

export const dynamic = "force-dynamic";

type Order = {
  id: string;
  viewer_id: string;
  item_type: string;
  amount: number;
  currency: string;
  gateway: string;
  status: string;
  payment_ref: string | null;
  note: string | null;
  created_at: string;
  decided_at: string | null;
  viewers: { phone_e164: string } | null;
  admin_users: { email: string } | null;
};

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; q?: string }> }) {
  await requireAdmin("orders");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().toUpperCase();

  const select = "id, viewer_id, item_type, amount, currency, gateway, status, payment_ref, note, created_at, decided_at, viewers(phone_e164), admin_users:decided_by(email)";
  let pendingQuery = db().from("orders").select(select).eq("gateway", "cash").eq("status", "pending").order("created_at", { ascending: true });
  if (q) pendingQuery = pendingQuery.ilike("payment_ref", `%${q.replace(/[^A-Z0-9-]/g, "")}%`);
  const [{ data: pending }, { data: recent }] = await Promise.all([
    pendingQuery,
    db().from("orders").select(select).neq("status", "pending").order("created_at", { ascending: false }).limit(50),
  ]);

  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dubai" });
  const mask = (p?: string) => (p && p.length > 6 ? `${p.slice(0, 6)} ••• ${p.slice(-2)}` : (p ?? "—"));
  const totals = ((pending ?? []) as unknown as Order[]).reduce<Record<string, number>>((acc, o) => {
    acc[o.currency] = (acc[o.currency] ?? 0) + Number(o.amount);
    return acc;
  }, {});

  return (
    <>
      <h1>Orders & payments</h1>
      <Flash ok={sp.ok} err={sp.err} />
      <div className="card">
        Payment mode: <span className={`badge ${paymentMode() === "cash" ? "in_review" : "live"}`}>{paymentMode() === "cash" ? "manual cash / transfer" : "online (Tap)"}</span>
        <p className="muted" style={{ marginBottom: 0 }}>
          {paymentMode() === "cash"
            ? "Viewers request a pack and get a reference code. Contact them, collect the payment, then press “Mark paid”. Add TAP_SECRET_KEY in Vercel to switch to online payments."
            : "Online payments are on. Cash orders created earlier can still be approved here."}
        </p>
      </div>

      <form method="get" className="row card">
        <label>
          Find by reference
          <input name="q" defaultValue={q} placeholder="WC-7K3P9" />
        </label>
        <button type="submit" className="secondary" style={{ alignSelf: "end" }}>
          Search
        </button>
      </form>

      <h2>
        Waiting for payment ({(pending ?? []).length})
        {Object.keys(totals).length > 0 && <span className="muted"> · {Object.entries(totals).map(([c, v]) => `${c} ${v.toFixed(2)}`).join(" · ")}</span>}
      </h2>
      <table className="card">
        <thead>
          <tr>
            <th>Reference</th>
            <th>Viewer</th>
            <th>Item</th>
            <th>Amount</th>
            <th>Requested (GST)</th>
            <th>Decision</th>
          </tr>
        </thead>
        <tbody>
          {((pending ?? []) as unknown as Order[]).map((o) => (
            <tr key={o.id}>
              <td>
                <strong>{o.payment_ref}</strong>
              </td>
              <td>
                <Link href={`/admin/viewers/${o.viewer_id}`}>{mask(o.viewers?.phone_e164)}</Link>
              </td>
              <td>{o.note ?? o.item_type}</td>
              <td>
                {o.currency} {Number(o.amount).toFixed(2)}
              </td>
              <td>{fmt.format(new Date(o.created_at))}</td>
              <td>
                <form className="row">
                  <input type="hidden" name="id" value={o.id} />
                  <input type="hidden" name="back" value="/admin/orders" />
                  <input name="note" placeholder="Receipt / note" style={{ width: 150 }} />
                  <button formAction={approveOrderAction} type="submit">
                    Mark paid
                  </button>
                  <button formAction={cancelOrderAction} type="submit" className="secondary">
                    Cancel
                  </button>
                </form>
              </td>
            </tr>
          ))}
          {(pending ?? []).length === 0 && (
            <tr>
              <td colSpan={6} className="muted">
                Nothing waiting.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h2>Recent orders</h2>
      <table className="card">
        <thead>
          <tr>
            <th>When (GST)</th>
            <th>Reference</th>
            <th>Viewer</th>
            <th>Item</th>
            <th>Amount</th>
            <th>Method</th>
            <th>Status</th>
            <th>By</th>
          </tr>
        </thead>
        <tbody>
          {((recent ?? []) as unknown as Order[]).map((o) => (
            <tr key={o.id}>
              <td>{fmt.format(new Date(o.decided_at ?? o.created_at))}</td>
              <td>{o.payment_ref ?? "—"}</td>
              <td>
                <Link href={`/admin/viewers/${o.viewer_id}`}>{mask(o.viewers?.phone_e164)}</Link>
              </td>
              <td>{o.note ?? o.item_type}</td>
              <td>
                {o.currency === "XTR" ? `${Number(o.amount).toLocaleString("en-US")} ⭐` : `${o.currency} ${Number(o.amount).toFixed(2)}`}
              </td>
              <td>{o.gateway === "telegram" ? "Telegram Stars" : o.gateway}</td>
              <td>
                <span className={`badge ${o.status === "paid" ? "sent" : o.status}`}>{o.status === "failed" && o.gateway === "cash" ? "cancelled" : o.status}</span>
                {o.gateway === "telegram" && o.status === "paid" && (
                  <form action={refundStarsAction} style={{ display: "inline", marginInlineStart: 8 }}>
                    <input type="hidden" name="id" value={o.id} />
                    <button type="submit" className="secondary" style={{ padding: "2px 10px", fontSize: 12 }}>Refund Stars</button>
                  </form>
                )}
              </td>
              <td className="muted">{o.admin_users?.email ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
