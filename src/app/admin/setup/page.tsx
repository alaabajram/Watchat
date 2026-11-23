// One-time owner setup. Needs ADMIN_SETUP_TOKEN (set in Vercel) and works only while no admin exists.

import { Flash } from "@/components/admin/Flash";
import { PasswordInput } from "@/components/admin/PasswordInput";
import { MIN_PASSWORD_LENGTH } from "@/lib/security/password";
import { setupAction } from "../auth-actions";

export const dynamic = "force-dynamic";

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  return (
    <main className="admin-auth">
      <form action={setupAction} className="card">
        <h1>Create the owner account</h1>
        <p className="muted" style={{ margin: 0 }}>
          Works once. Paste the <code>ADMIN_SETUP_TOKEN</code> you set in Vercel.
        </p>
        <Flash ok={sp.ok} err={sp.err} />
        <label>
          Setup token
          <input name="token" type="password" required />
        </label>
        <label>
          Your name
          <input name="name" />
        </label>
        <label>
          Email
          <input name="email" type="email" autoComplete="username" required />
        </label>
        <label>
          Password ({MIN_PASSWORD_LENGTH}+ characters, letters and numbers)
          <PasswordInput name="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} />
        </label>
        <button type="submit">Create owner</button>
      </form>
    </main>
  );
}
