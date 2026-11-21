// The "ready to publish?" checklist: required items first, then nice-to-haves, each with a link to fix it.

import Link from "next/link";
import type { Readiness } from "@/lib/admin/readiness";

export function ReadinessChecklist({ r, seriesId, compact = false }: { r: Readiness; seriesId: string; compact?: boolean }) {
  const required = r.items.filter((i) => i.required);
  const extras = r.items.filter((i) => !i.required);
  const row = (i: Readiness["items"][number]) => (
    <li key={i.key} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "5px 0" }}>
      <span aria-hidden="true" style={{ width: 20, textAlign: "center", color: i.done ? "#15803d" : i.required ? "#b45309" : "#9ca3af", fontWeight: 700 }}>
        {i.done ? "✓" : i.required ? "!" : "○"}
      </span>
      <span style={{ flex: 1 }}>
        <strong style={{ fontWeight: 600 }}>{i.label}</strong> <span className="muted">· {i.detail}</span>
      </span>
      {!i.done && (
        <Link href={i.step === 1 ? `/admin/series/${seriesId}#details` : `/admin/series/${seriesId}/launch?step=${i.step}`} style={{ whiteSpace: "nowrap" }}>
          Fix →
        </Link>
      )}
    </li>
  );
  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: 17, color: r.ready ? "#15803d" : "#b45309", marginBottom: 6 }}>
        {r.ready ? "✓ " : ""}
        {r.summary}
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>{required.map(row)}</ul>
      {!compact && extras.some((i) => !i.done) && (
        <details style={{ marginTop: 6 }}>
          <summary className="muted" style={{ cursor: "pointer" }}>
            Nice to have ({extras.filter((i) => i.done).length}/{extras.length})
          </summary>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>{extras.map(row)}</ul>
        </details>
      )}
    </div>
  );
}

const STEPS = ["Details", "Artwork", "Episodes", "Free episodes & price", "Licence & publish"] as const;

/** 1 · Details › 2 · Artwork › … — finished steps link back. */
export function LaunchSteps({ step, seriesId }: { step: number; seriesId: string | null }) {
  return (
    <ol style={{ display: "flex", flexWrap: "wrap", gap: 8, listStyle: "none", padding: 0, margin: "0 0 16px" }}>
      {STEPS.map((label, i) => {
        const n = i + 1;
        const current = n === step;
        const href = seriesId ? (n === 1 ? `/admin/series/${seriesId}#details` : `/admin/series/${seriesId}/launch?step=${n}`) : null;
        const pill = (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 14px",
              borderRadius: 999,
              fontWeight: current ? 700 : 500,
              background: current ? "var(--a-brand, #31e5a0)" : n < step ? "#e7f8f0" : "#f1f0f3",
              color: current ? "#0d0b12" : n < step ? "#166534" : "#6b6475",
            }}
          >
            {n < step ? "✓" : n} · {label}
          </span>
        );
        return <li key={label}>{href && !current ? <Link href={href} style={{ textDecoration: "none" }}>{pill}</Link> : pill}</li>;
      })}
    </ol>
  );
}
