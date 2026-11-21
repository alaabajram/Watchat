// The flow builder's three sections. Shown at the top of Series flows, Sequence flows and Shared replies.

import Link from "next/link";

const TABS = [
  { key: "series", href: "/admin/flows", label: "Series chats", help: "What each series' chat sends, step by step, after a viewer sends its code." },
  { key: "sequences", href: "/admin/sequences", label: "Follow-ups", help: "Messages Watchat sends by itself later, e.g. a reminder 24 h after someone stops watching." },
  { key: "replies", href: "/admin/bot", label: "Menu & common replies", help: "Answers every series shares: the menu, my account, help, stop and unknown messages." },
] as const;

export function FlowTabs({ current }: { current: (typeof TABS)[number]["key"] }) {
  return (
    <>
      <h1 style={{ marginBottom: 12 }}>Chat flows</h1>
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
      <p className="muted" style={{ margin: "-8px 0 18px" }}>{TABS.find((t) => t.key === current)?.help}</p>
    </>
  );
}
