import { Flash } from "@/components/admin/Flash";
import { requireSignedIn } from "@/lib/admin/auth";
import { MIN_PASSWORD_LENGTH } from "@/lib/security/password";
import { changePasswordAction } from "../../auth-actions";

export const dynamic = "force-dynamic";

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; first?: string }> }) {
  const admin = await requireSignedIn();
  const sp = await searchParams;
  return (
    <>
      <h1>Your account</h1>
      {(sp.first || admin.mustChangePassword) && <Flash err="Set your own password before using the admin." />}
      <Flash ok={sp.ok} err={sp.err} />
      <form action={changePasswordAction} className="card" style={{ maxWidth: 420, display: "flex", flexDirection: "column", gap: 12 }}>
        <p className="muted" style={{ margin: 0 }}>
          {admin.email} · {admin.role}
        </p>
        <label>
          Current password
          <input name="current" type="password" autoComplete="current-password" required />
        </label>
        <label>
          New password ({MIN_PASSWORD_LENGTH}+ characters, letters and numbers)
          <input name="next" type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required />
        </label>
        <button type="submit">Change password</button>
      </form>
    </>
  );
}
