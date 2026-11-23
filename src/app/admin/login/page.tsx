import { redirect } from "next/navigation";
import { Flash } from "@/components/admin/Flash";
import { PasswordInput } from "@/components/admin/PasswordInput";
import { getAdmin } from "@/lib/admin/auth";
import { loginAction } from "../auth-actions";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  if (await getAdmin()) redirect("/admin");
  const sp = await searchParams;
  return (
    <main className="admin-auth">
      <form action={loginAction} className="card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/wordmark-en-dark.png" alt="Watchat" style={{ height: 32, width: "auto", alignSelf: "flex-start" }} />
        <h1 style={{ margin: "4px 0 0", fontSize: 22 }}>Sign in to the admin</h1>
        <Flash ok={sp.ok} err={sp.err} />
        <label>
          Email
          <input name="email" type="email" autoComplete="username" required />
        </label>
        <label>
          <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            Password
            <a href="/admin/forgot" style={{ fontSize: 13, fontWeight: 500 }}>
              Forgot password?
            </a>
          </span>
          <PasswordInput name="password" autoComplete="current-password" />
        </label>
        <button type="submit">Sign in</button>
        <p className="muted" style={{ margin: 0 }}>
          First time? <a href="/admin/setup">Create the owner account</a>.
        </p>
      </form>
    </main>
  );
}
