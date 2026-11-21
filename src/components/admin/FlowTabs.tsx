// The flow builder's three sections. Shown at the top of Series flows, Sequence flows and Shared replies.

import Link from "next/link";

const TABS = [
  { key: "series", href: "/admin/flows", label: "Series flows", help: "The chat for each series: starts when a viewer sends the code" },
  { key: "sequences", href: "/admin/sequences", label: "Sequence flows", help: "Follow-ups we send first: approved templates after a trigger" },
  { key: "replies", href: "/admin/bot", label: "Shared replies", help: "Texts every series uses (menu, help, errors…)" },
] as const;

export function FlowTabs({ current }: { current: (typeof TABS)[number]["key"] }) {
  return (
    <>
      <h1 style={{ marginBottom: 12 }}>Flow builder</h1>
      <nav aria-label="Flow builder sections" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
        {TABS.map((t) => {
          const on = t.key === current;
          return (
            <Link
              key={t.key}
              href={t.href}
              aria-current={on ? "page" : undefined}
              title={t.help}
              style={{
                padding: "10px 18px",
                borderRadius: 14,
                textDecoration: "none",
                fontWeight: 600,
                background: on ? "var(--a-text)" : "#fff",
                color: on ? "#fff" : "var(--a-text)",
                boxShadow: on ? "none" : "var(--a-shadow)",
              }}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
