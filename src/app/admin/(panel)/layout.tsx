// Admin shell: sidebar shows only the areas this admin's role may use.

import Link from "next/link";
import { AdminNavLinks, type NavItem } from "@/components/admin/AdminNav";
import { can, requireSignedIn, type Area } from "@/lib/admin/auth";
import { logoutAction } from "../auth-actions";

export const dynamic = "force-dynamic";

const NAV: (NavItem & { area: Area })[] = [
  { href: "/admin", label: "Dashboard", area: "dashboard", icon: "dashboard", group: "Overview" },
  { href: "/admin/spend", label: "Spend", area: "spend", icon: "spend", group: "Overview" },
  { href: "/admin/series", label: "CMS", area: "content", icon: "cms", group: "Content" },
  // Automations, in the order they build on each other: the chat flow per series, then the follow-ups
  // (rules, one-offs, AI), then the building blocks they all send (approved templates, shared bot texts).
  { href: "/admin/flows", label: "Flow builder", area: "bot", icon: "flow", group: "Automations" },
  { href: "/admin/sequences", label: "Sequences", area: "messaging", icon: "sequence", group: "Automations" },
  { href: "/admin/campaigns", label: "Campaigns", area: "messaging", icon: "campaign", group: "Automations" },
  { href: "/admin/growth", label: "Growth agent", area: "growth", icon: "growth", group: "Automations" },
  { href: "/admin/templates", label: "WhatsApp templates", area: "messaging", icon: "template", group: "Automations" },
  { href: "/admin/bot", label: "Shared replies", area: "bot", icon: "replies", group: "Automations" },
  { href: "/admin/viewers", label: "Viewers", area: "viewers", icon: "viewers", group: "Viewers & money" },
  { href: "/admin/orders", label: "Orders & payments", area: "orders", icon: "orders", group: "Viewers & money" },
  { href: "/admin/pricing", label: "Pricing", area: "pricing", icon: "pricing", group: "Viewers & money" },
  { href: "/admin/team", label: "Team", area: "team", icon: "team", group: "Settings" },
  { href: "/admin/ai", label: "AI account", area: "aiAccount", icon: "ai", group: "Settings" },
  { href: "/admin/audit", label: "Audit log", area: "audit", icon: "audit", group: "Settings" },
];

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireSignedIn();
  return (
    <div className="admin-shell">
      <nav className="admin-nav">
        <Link href="/admin" className="brand" aria-label="Watchat admin home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/wordmark-en-white.png" alt="Watchat" />
          <span>Admin</span>
        </Link>
        <AdminNavLinks items={NAV.filter((n) => can(admin, n.area)).map(({ href, label, icon, group }) => ({ href, label, icon, group }))} />
        <div className="who">
          {admin.email}
          <br />
          {admin.role} · <Link href="/admin/account">Password</Link>
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
