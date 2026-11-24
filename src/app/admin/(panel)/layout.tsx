// Admin shell: sidebar shows only the areas this admin's role may use.

import Link from "next/link";
import { AdminNavLinks, type NavItem } from "@/components/admin/AdminNav";
import { can, requireSignedIn, type Area } from "@/lib/admin/auth";
import { getSiteSafe } from "@/lib/site/store";
import { logoutAction } from "../auth-actions";

export const dynamic = "force-dynamic";

// Day-to-day work first; marketing and settings fold away (they open on their own pages, or for roles that live there).
const NAV: (NavItem & { area: Area })[] = [
  { href: "/admin", label: "Dashboard", area: "dashboard", icon: "dashboard", group: "", hint: "How viewers and money are doing" },
  { href: "/admin/series", label: "Series", area: "content", icon: "cms", group: "", hint: "Add and publish series and episodes", also: ["/admin/series/new"] },
  { href: "/admin/studio", label: "Studio", area: "content", icon: "ai", group: "", hint: "Write and illustrate story episodes with Claude; review and publish" },
  { href: "/admin/viewers", label: "Viewers", area: "viewers", icon: "viewers", group: "", hint: "Find a viewer, see their wallet and history" },
  { href: "/admin/orders", label: "Orders & payments", area: "orders", icon: "orders", group: "", hint: "Purchases, refunds and cash payments" },
  { href: "/admin/pricing", label: "Prices & Ping", area: "pricing", icon: "pricing", group: "Money", hint: "Passes, Ping packs and Stars prices per country" },
  { href: "/admin/offers", label: "Offers & rewards", area: "offers", icon: "offers", group: "Money", hint: "Welcome Ping, check-ins, promo codes, partners" },
  // Marketing: what the chat sends and the follow-ups. Flow builder = Series flows · Sequence flows · Shared replies (tabs).
  { href: "/admin/flows", label: "Chat flows", area: "bot", icon: "flow", group: "Marketing", hint: "What the WhatsApp / Telegram chat sends, step by step", also: ["/admin/sequences", "/admin/bot"] },
  { href: "/admin/campaigns", label: "Campaigns", area: "messaging", icon: "campaign", group: "Marketing", hint: "One-off messages to a group of viewers" },
  { href: "/admin/growth", label: "Growth agent", area: "growth", icon: "growth", group: "Marketing", hint: "AI suggestions to bring back viewers who slip away" },
  { href: "/admin/templates", label: "Message templates", area: "messaging", icon: "template", group: "Marketing", hint: "WhatsApp-approved messages used by follow-ups" },
  { href: "/admin/spend", label: "WhatsApp costs", area: "spend", icon: "spend", group: "Marketing", hint: "What WhatsApp messages cost, and the budget" },
  { href: "/admin/site", label: "Brand & site", area: "site", icon: "brand", group: "Settings", hint: "Logo, colours, address, Telegram, storage" },
  { href: "/admin/team", label: "Team", area: "team", icon: "team", group: "Settings", hint: "Who can sign in, and what they can do" },
  { href: "/admin/ai", label: "AI account", area: "aiAccount", icon: "ai", group: "Settings", hint: "AI usage and limits" },
  { href: "/admin/audit", label: "Audit log", area: "audit", icon: "audit", group: "Settings", hint: "Who changed what, and when" },
];

/** Folded groups and when they start open: the group a role mainly works in. */
const FOLDED: Record<string, readonly string[]> = { Marketing: ["marketing"], Settings: [] };

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const [admin, site] = await Promise.all([requireSignedIn(), getSiteSafe()]);
  return (
    <div className="admin-shell">
      <nav className="admin-nav">
        <Link href="/admin" className="brand" aria-label="Watchat admin home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={site.logoOnDark} alt={site.nameEn} />
          <span>Admin</span>
        </Link>
        <AdminNavLinks
          items={NAV.flatMap((n) => {
            // A role that can run sequences but not edit the series chats still reaches the Flow builder, on Sequence flows.
            if (n.href === "/admin/flows" && !can(admin, "bot") && can(admin, "messaging")) return [{ ...n, href: "/admin/sequences", also: ["/admin/flows"] }];
            return can(admin, n.area) ? [n] : [];
          })}
          folded={Object.fromEntries(Object.entries(FOLDED).map(([g, roles]) => [g, !roles.includes(admin.role)]))}
        />
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
