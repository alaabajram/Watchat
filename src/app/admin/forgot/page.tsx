// "Forgot password?" for admins: an emailed reset link (when email is set up), the owner's setup-token
// recovery, or asking an owner (Team → Reset password).

import { redirect } from "next/navigation";
import { Flash } from "@/components/admin/Flash";
import { PasswordInput } from "@/components/admin/PasswordInput";
import { getAdmin } from "@/lib/admin/auth";
import { emailReady } from "@/lib/email";
import { MIN_PASSWORD_LENGTH } from "@/lib/security/password";
import { ownerRecoveryAction, requestPasswordResetAction } from "../auth-actions";

export const dynamic = "force-dynamic";

export default async function ForgotPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  if (await getAdmin()) redirect("/admin");
  const sp = await searchParams;
  const email = emailReady();
  return (
    <main className="admin-auth" style={{ alignContent: "center", gap: 16, padding: "24px 0" }}>
      <form action={requestPasswordResetAction} className="card">
        <h1 style={{ margin: 0, fontSize: 22 }}>Forgot your password?</h1>
        <Flash ok={sp.ok} err={sp.err} />
        {email ? (
          <>
            <p className="muted" style={{ margin: 0 }}>
              Enter your admin email and we&apos;ll send you a link to choose a new password.
            </p>
            <label>
              Email
              <input name="email" type="email" autoComplete="username" required />
            </label>
            <button type="submit">Send the reset link</button>
          </>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            Email isn&apos;t set up yet, so a reset link can&apos;t be sent. <strong>Team members:</strong> ask an owner to press <em>Reset password</em> next to
            your name in Team; they&apos;ll give you a temporary password. <strong>Owners:</strong> use the setup token below.
          </p>
        )}
        <p className="muted" style={{ margin: 0 }}>
          <a href="/admin/login">← Back to sign in</a>
        </p>
      </form>

      <details className="card" style={{ width: 380, maxWidth: "calc(100vw - 32px)", background: "#fff", padding: "18px 32px", borderRadius: 28 }} open={!email}>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>Owner without email access</summary>
        <form action={ownerRecoveryAction} style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12, padding: 0, boxShadow: "none", width: "auto" }}>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Paste the <code>ADMIN_SETUP_TOKEN</code> from Vercel (Settings → Environment Variables) to set a new password for an owner account.
          </p>
          <label>
            Owner email
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <label>
            Setup token
            <input name="token" type="password" autoComplete="off" required />
          </label>
          <label>
            New password ({MIN_PASSWORD_LENGTH}+ characters, letters and numbers)
            <PasswordInput name="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} />
          </label>
          <label>
            New password again
            <PasswordInput name="confirm" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} />
          </label>
          <button type="submit">Set the new password</button>
        </form>
      </details>
    </main>
  );
}
