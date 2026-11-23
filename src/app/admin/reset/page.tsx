// The page an emailed reset link opens: choose a new admin password.

import { Flash } from "@/components/admin/Flash";
import { PasswordInput } from "@/components/admin/PasswordInput";
import { MIN_PASSWORD_LENGTH } from "@/lib/security/password";
import { resetPasswordAction } from "../auth-actions";

export const dynamic = "force-dynamic";

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string; err?: string }> }) {
  const sp = await searchParams;
  const token = typeof sp.token === "string" && /^[A-Za-z0-9_-]{20,100}$/.test(sp.token) ? sp.token : "";
  return (
    <main className="admin-auth">
      <form action={resetPasswordAction} className="card">
        <h1 style={{ margin: 0, fontSize: 22 }}>Choose a new password</h1>
        <Flash err={sp.err} />
        {token ? (
          <>
            <input type="hidden" name="token" value={token} />
            <label>
              New password ({MIN_PASSWORD_LENGTH}+ characters, letters and numbers)
              <PasswordInput name="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} />
            </label>
            <label>
              New password again
              <PasswordInput name="confirm" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} />
            </label>
            <button type="submit">Save the new password</button>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>You&apos;ll be signed out everywhere and can sign in with the new password.</p>
          </>
        ) : (
          <p>
            This link isn&apos;t complete. <a href="/admin/forgot">Ask for a new one</a>.
          </p>
        )}
      </form>
    </main>
  );
}
