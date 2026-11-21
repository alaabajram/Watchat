// All · WhatsApp · Telegram tabs for the Flow builder lists (Series flows, Sequences). Server component.

import Link from "next/link";
import { CHANNEL_COLOR } from "@/lib/flows/types";

export type AppFilter = "all" | "whatsapp" | "telegram";
export const appFilter = (v?: string): AppFilter => (v === "whatsapp" || v === "telegram" ? v : "all");

export function ChannelTabs({ base, current, counts }: { base: string; current: AppFilter; counts: Record<AppFilter, number> }) {
  const items: { key: AppFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "whatsapp", label: "WhatsApp" },
    { key: "telegram", label: "Telegram" },
  ];
  return (
    <nav aria-label="Chat app" style={{ display: "flex", gap: 6, margin: "4px 0 12px" }}>
      {items.map((i) => {
        const on = i.key === current;
        const color = i.key === "all" ? "var(--a-text)" : CHANNEL_COLOR[i.key];
        return (
          <Link
            key={i.key}
            href={i.key === "all" ? base : `${base}?app=${i.key}`}
            aria-current={on ? "page" : undefined}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "7px 14px",
              borderRadius: 999,
              textDecoration: "none",
              fontWeight: 600,
              fontSize: 13,
              background: on ? color : "#f4f2ee",
              color: on ? "#fff" : "var(--a-text)",
            }}
          >
            {i.key !== "all" && <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: on ? "#fff" : color }} />}
            {i.label} <span style={{ opacity: 0.7, fontWeight: 500 }}>{counts[i.key]}</span>
          </Link>
        );
      })}
    </nav>
  );
}
