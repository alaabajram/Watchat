// Admin shell: sidebar shows only the areas this admin's role may use.

import Link from "next/link";
import { can, requireSignedIn, type Area } from "@/lib/admin/auth";
import { logoutAction } from "../auth-actions";

export const dynamic = "force-dynamic";

const NAV: { href: string; label: string; area: Area }[] = [
  { href: "/admin", label: "Dashboard", area: "dashboard" },
  { href: "/admin/series", label: "Series & episodes", area: "content" },
  { href: "/admin/bot", label: "Bot messages & scenarios", area: "bot" },
  { href: "/admin/templates", label: "WhatsApp templates", area: "messaging" },
  { href: "/admin/sequences", label: "Sequences", area: "messaging" },
  { href: "/admin/campaigns", label: "Campaigns", area: "messaging" },
  { href: "/admin/viewers", label: "Viewers", area: "viewers" },
  { href: "/admin/pricing", label: "Pricing", area: "pricing" },
  { href: "/admin/team", label: "Team", area: "team" },
  { href: "/admin/audit", label: "Audit log", area: "audit" },
];

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireSignedIn();
  return (
    <div className="admin-shell">
      <nav className="admin-nav">
        <div className="brand">Watchat · واتشات</div>
        {NAV.filter((n) => can(admin, n.area)).map((n) => (
          <Link key={n.href} href={n.href}>
            {n.label}
          </Link>
        ))}
        <div className="who">
          {admin.email}
          <br />
          {admin.role} · <Link href="/admin/account" style={{ color: "#9ca3af" }}>Password</Link>
          <form action={logoutAction} style={{ marginTop: 8 }}>
            <button type="submit" className="secondary" style={{ padding: "4px 10px" }}>
              Sign out
            </button>
          </form>
        </div>
      </nav>
      <main className="admin-main">{children}</main>
    </div>
  );
}
