// A small CTR meter: rate, sample, and a verdict (working / fair / not working / too early).

import { ctr, health, HEALTH_COLOR, HEALTH_LABEL, type CTR_RULES } from "@/lib/ctr/ctr";

export function CtrMeter({ clicks, base, kind, measurable = true }: { clicks: number; base: number; kind: keyof typeof CTR_RULES; measurable?: boolean }) {
  if (!measurable) return <span className="muted" title="This template has no link button, so clicks can't be counted. Use “Watched in 48 h”.">no link to count</span>;
  const h = health(clicks, base, kind);
  const rate = ctr(clicks, base);
  return (
    <div style={{ minWidth: 150 }} title={`${clicks} of ${base} clicked`}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <strong style={{ color: HEALTH_COLOR[h] }}>{rate == null ? "—" : `${Math.round(rate * 100)}%`}</strong>
        <span className="muted" style={{ fontSize: 12 }}>
          {clicks}/{base}
        </span>
      </div>
      <div style={{ height: 6, background: "var(--a-line)", borderRadius: 3, overflow: "hidden", margin: "3px 0" }}>
        <div style={{ height: 6, width: `${Math.round((rate ?? 0) * 100)}%`, background: HEALTH_COLOR[h] }} />
      </div>
      <span style={{ fontSize: 12, color: HEALTH_COLOR[h] }}>{HEALTH_LABEL[h]}</span>
    </div>
  );
}
