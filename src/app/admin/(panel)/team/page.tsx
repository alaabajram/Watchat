import { Flash } from "@/components/admin/Flash";
import { PERMISSIONS, requireAdmin } from "@/lib/admin/auth";
import { db } from "@/lib/supabase";
import { inviteAdminAction, updateAdminAction } from "../../people-actions";

export const dynamic = "force-dynamic";

const ROLES = ["owner", "content", "marketing", "support", "finance"] as const;

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const admin = await requireAdmin("team");
  const sp = await searchParams;
  const { data: users } = await db()
    .from("admin_users")
    .select("id, email, name, role, last_login_at, disabled_at, must_change_password")
    .eq("tenant_id", admin.tenantId)
    .order("created_at");
  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Asia/Dubai" });

  return (
    <>
      <h1>Team</h1>
      <Flash ok={sp.ok} err={sp.err} />
      <table className="card">
        <thead>
          <tr>
            <th>Person</th>
            <th>Last sign-in</th>
            <th>Role & access</th>
          </tr>
        </thead>
        <tbody>
          {(users ?? []).map((u) => (
            <tr key={u.id}>
              <td>
                {u.name ?? u.email}
                <div className="muted">{u.email}</div>
                {u.must_change_password && <span className="badge in_review">temporary password</span>}
              </td>
              <td>{u.last_login_at ? fmt.format(new Date(u.last_login_at)) : "never"}</td>
              <td>
                {u.id === admin.id ? (
                  <span className="badge">{u.role} (you)</span>
                ) : (
                  <form action={updateAdminAction} className="row">
                    <input type="hidden" name="id" value={u.id} />
                    <select name="role" defaultValue={u.role}>
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                    <label className="inline">
                      <input type="checkbox" name="disabled" defaultChecked={Boolean(u.disabled_at)} /> Disabled
                    </label>
                    <button type="submit" className="secondary">
                      Save
                    </button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form action={inviteAdminAction} className="card">
        <h2 style={{ marginTop: 0 }}>Add a team member</h2>
        <div className="grid3">
          <label>
            Name
            <input name="name" />
          </label>
          <label>
            Email
            <input name="email" type="email" required />
          </label>
          <label>
            Role
            <select name="role" defaultValue="content">
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p>
          <button type="submit">Create account</button>
        </p>
        <p className="muted" style={{ marginBottom: 0 }}>
          Access by role:{" "}
          {Object.entries(PERMISSIONS)
            .map(([area, roles]) => `${area}: ${roles.join(", ")}`)
            .join(" · ")}
        </p>
      </form>
    </>
  );
}
