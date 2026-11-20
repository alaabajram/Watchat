"use client";
// Admin sidebar links: grouped, with icons, and the current page highlighted (mint, like the viewer app).

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string; icon: IconName; group: string };
export type IconName =
  | "dashboard" | "spend" | "cms" | "flow" | "replies" | "template" | "sequence" | "campaign"
  | "growth" | "viewers" | "orders" | "pricing" | "team" | "ai" | "audit";

const PATHS: Record<IconName, string> = {
  dashboard: "M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-4H4zM14 4v4h6V4z",
  spend: "M12 3v18M16.5 7.5c0-1.7-2-3-4.5-3s-4.5 1.3-4.5 3S9.5 10.5 12 11s4.5 1.3 4.5 3.5-2 3-4.5 3-4.5-1.3-4.5-3",
  cms: "M4 5h16v14H4zM4 9h16M9 9v10",
  flow: "M6 4h5v5H6zM13 15h5v5h-5zM8.5 9v3.5h7V15",
  replies: "M21 12a8 8 0 0 1-11.8 7L4 20.5l1.5-5A8 8 0 1 1 21 12zM8.5 11h7M8.5 14h4",
  template: "M5 4h14v16H5zM9 8h6M9 12h6M9 16h3",
  sequence: "M5 6h4M5 12h8M5 18h12M17 4l2 2-2 2",
  campaign: "M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15.5 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12",
  growth: "M4 18l6-6 4 4 6-8M15 8h5v5",
  viewers: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14a6 6 0 0 1 3.5 6",
  orders: "M4 7h16v12H4zM4 11h16M8 15h3",
  pricing: "M3.5 12.5l8-8H20v8.5l-8 8zM15.5 8.5h.01",
  team: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  ai: "M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z",
  audit: "M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7zM9 12l2 2 4-4",
};

// Pictures instead of line icons for a few tabs (the growth agent's robot mascot).
const IMAGES: Partial<Record<IconName, string>> = { growth: "/brand/growth-agent-96.png" };

function Icon({ name }: { name: IconName }) {
  const img = IMAGES[name];
  if (img) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={img} alt="" width={24} height={24} aria-hidden="true" style={{ margin: "-3px", flexShrink: 0 }} />;
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}

export function AdminNavLinks({ items }: { items: NavItem[] }) {
  const path = usePathname();
  const isCurrent = (href: string) => (href === "/admin" ? path === "/admin" : path === href || path.startsWith(`${href}/`));
  let lastGroup = "";
  return (
    <>
      {items.map((n) => {
        const header = n.group !== lastGroup ? n.group : null;
        lastGroup = n.group;
        return (
          <div key={n.href} style={{ display: "contents" }}>
            {header && <div className="section">{header}</div>}
            <Link href={n.href} aria-current={isCurrent(n.href) ? "page" : undefined}>
              <Icon name={n.icon} />
              {n.label}
            </Link>
          </div>
        );
      })}
    </>
  );
}
