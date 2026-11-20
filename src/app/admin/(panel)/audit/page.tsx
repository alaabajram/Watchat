import { requireAdmin } from "@/lib/admin/auth";
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const admin = await requireAdmin("audit");
  const { data: rows } = await db()
    .from("audit_log")
    .select("id, action, entity, entity_id, details, created_at, admin_users(email)")
    .eq("tenant_id", admin.tenantId)
    .order("created_at", { ascending: false })
    .limit(300);
  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "short", timeStyle: "medium", timeZone: "Asia/Dubai" });
  return (
    <>
      <h1>Audit log</h1>
      <p className="muted">Every change made in the admin, newest first (last 300).</p>
      <table className="card">
        <thead>
          <tr>
            <th>When (GST)</th>
            <th>Who</th>
            <th>Action</th>
            <th>On</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {(rows ?? []).map((r) => (
            <tr key={r.id}>
              <td>{fmt.format(new Date(r.created_at))}</td>
              <td>{(r.admin_users as unknown as { email: string } | null)?.email ?? "—"}</td>
              <td>
                <code>{r.action}</code>
              </td>
              <td className="muted">
                {r.entity} {r.entity_id ? String(r.entity_id).slice(0, 8) : ""}
              </td>
              <td className="muted" style={{ maxWidth: 360, overflowWrap: "anywhere" }}>
                {JSON.stringify(r.details).slice(0, 200)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
