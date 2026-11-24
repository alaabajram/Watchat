"use client";

// The episode's routing at a glance: scenes in columns by how far they are from the start, arrows for every
// route (continue, each choice, both ways of a branch). A long path wraps onto the next line (like text) so the
// whole episode fits the width; − / + / Fit zoom. Click a scene to edit it.

import { useEffect, useMemo, useRef, useState } from "react";
import { targetsOf } from "@/lib/story/engine";
import type { Scene, StoryGraph } from "@/lib/story/types";

const W = 150;
const H = 46;
const GX = 60;
const GY = 18;
const BAND_GAP = 34;

export function StoryMap(p: { story: StoryGraph; selected: string | null; onSelect: (id: string) => void; issueIds: Set<string> }) {
  const box = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(900);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setAvail(el.clientWidth || 900));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // How many columns fit on one line at this zoom.
  const perRow = Math.max(2, Math.floor((avail / zoom - 20) / (W + GX)));

  const layout = useMemo(() => {
    // Column = shortest number of steps from the start; scenes nobody reaches go in a last column.
    const col = new Map<string, number>();
    const start = p.story.start ?? p.story.scenes[0]?.id;
    const queue: string[] = start ? [start] : [];
    if (start) col.set(start, 0);
    while (queue.length) {
      const id = queue.shift()!;
      const s = p.story.scenes.find((x) => x.id === id);
      if (!s) continue;
      for (const t of targetsOf(s)) if (t && !col.has(t)) {
        col.set(t, (col.get(id) ?? 0) + 1);
        queue.push(t);
      }
    }
    const maxCol = Math.max(0, ...col.values());
    for (const s of p.story.scenes) if (!col.has(s.id)) col.set(s.id, maxCol + 1);
    // Row inside each column, then lines ("bands") of perRow columns each.
    const rows = new Map<number, number>();
    const rowOf = new Map<string, number>();
    for (const s of p.story.scenes) {
      const c = col.get(s.id) ?? 0;
      const r = rows.get(c) ?? 0;
      rows.set(c, r + 1);
      rowOf.set(s.id, r);
    }
    const cols = Math.max(0, ...col.values()) + 1;
    const bands = Math.ceil(cols / perRow);
    const bandTop: number[] = [];
    let y = 10;
    for (let b = 0; b < bands; b++) {
      bandTop.push(y);
      let tallest = 1;
      for (let c = b * perRow; c < Math.min(cols, (b + 1) * perRow); c++) tallest = Math.max(tallest, rows.get(c) ?? 0);
      y += tallest * (H + GY) + BAND_GAP;
    }
    const pos = new Map<string, { x: number; y: number; band: number }>();
    for (const s of p.story.scenes) {
      const c = col.get(s.id) ?? 0;
      const band = Math.floor(c / perRow);
      pos.set(s.id, { x: 10 + (c % perRow) * (W + GX), y: bandTop[band] + (rowOf.get(s.id) ?? 0) * (H + GY), band });
    }
    const width = 20 + Math.min(cols, perRow) * (W + GX) - GX + 10;
    const height = y - BAND_GAP + 10;
    return { pos, width, height };
  }, [p.story, perRow]);

  const edges: { from: Scene; to: string; label: string; kind: "next" | "choice" | "premium" | "yes" | "no" }[] = [];
  for (const s of p.story.scenes) {
    const r = s.route;
    if (r.type === "next" && r.to) edges.push({ from: s, to: r.to, label: "", kind: "next" });
    if (r.type === "choices") for (const c of r.options) if (c.to) edges.push({ from: s, to: c.to, label: c.label.en || c.label.ar, kind: c.price > 0 ? "premium" : "choice" });
    if (r.type === "branch") {
      if (r.ifSet) edges.push({ from: s, to: r.ifSet, label: `if ${r.flag}`, kind: "yes" });
      if (r.ifNot) edges.push({ from: s, to: r.ifNot, label: "otherwise", kind: "no" });
    }
  }
  const color = { next: "#9a93a6", choice: "#3b82f6", premium: "#ff5a48", yes: "#16a34a", no: "#a16207" };

  if (!p.story.scenes.length) return null;
  const z = (f: number) => setZoom((v) => Math.min(1.6, Math.max(0.4, Math.round(v * f * 100) / 100)));
  return (
    <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
      <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
        <span className="muted" style={{ fontSize: 12, marginInlineEnd: "auto" }}>
          {p.story.scenes.length} scenes · {Math.round(zoom * 100)}%
        </span>
        <button type="button" className="secondary small" onClick={() => z(1 / 1.2)} aria-label="Zoom out">
          −
        </button>
        <button type="button" className="secondary small" onClick={() => setZoom(1)}>
          Fit
        </button>
        <button type="button" className="secondary small" onClick={() => z(1.2)} aria-label="Zoom in">
          +
        </button>
      </div>
    <div ref={box} style={{ overflow: "auto", border: "1px solid #e7e3ee", borderRadius: 12, background: "#faf9fc", maxHeight: "70vh", width: "100%" }}>
      <svg width={layout.width * zoom} height={layout.height * zoom} viewBox={`0 0 ${layout.width} ${layout.height}`} style={{ display: "block", direction: "ltr" }}>
        <defs>
          {Object.entries(color).map(([k, c]) => (
            <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" fill={c} />
            </marker>
          ))}
        </defs>
        {edges.map((e, i) => {
          const a = layout.pos.get(e.from.id);
          const b = layout.pos.get(e.to);
          if (!a || !b) return null;
          // Onto the next line: down from the scene, back along the gap between lines, down into the next scene.
          if (b.band > a.band) {
            const gapY = b.y - BAND_GAP / 2 - 4;
            const d = `M${a.x + W / 2} ${a.y + H} V ${gapY} H ${b.x + W / 2} V ${b.y}`;
            return (
              <g key={i}>
                <path d={d} fill="none" stroke={color[e.kind]} strokeWidth={1.6} markerEnd={`url(#arrow-${e.kind})`} strokeDasharray={e.kind === "no" ? "4 3" : "6 3"} strokeLinejoin="round" />
                {e.label && (
                  <text x={(a.x + b.x + W) / 2} y={gapY - 4} fontSize={10} fill={color[e.kind]} textAnchor="middle">
                    {e.label.slice(0, 16)}
                  </text>
                )}
              </g>
            );
          }
          const back = b.band < a.band || b.x <= a.x;
          const x1 = a.x + W;
          const y1 = a.y + H / 2;
          const x2 = back ? b.x + W / 2 : b.x;
          const y2 = back ? b.y + (b.y > a.y ? 0 : H) : b.y + H / 2;
          const d = back ? `M${x1} ${y1} C ${x1 + 40} ${y1}, ${x2} ${y2 + (b.y > a.y ? -40 : 40)}, ${x2} ${y2}` : `M${x1} ${y1} C ${x1 + GX / 2} ${y1}, ${x2 - GX / 2} ${y2}, ${x2} ${y2}`;
          return (
            <g key={i}>
              <path d={d} fill="none" stroke={color[e.kind]} strokeWidth={1.6} markerEnd={`url(#arrow-${e.kind})`} strokeDasharray={e.kind === "no" ? "4 3" : undefined} />
              {e.label && (
                <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 4} fontSize={10} fill={color[e.kind]} textAnchor="middle">
                  {e.label.slice(0, 16)}
                </text>
              )}
            </g>
          );
        })}
        {p.story.scenes.map((s, i) => {
          const pt = layout.pos.get(s.id)!;
          const on = s.id === p.selected;
          const ends = s.route.type === "end" || (s.route.type === "next" && !s.route.to);
          return (
            <g key={s.id} transform={`translate(${pt.x} ${pt.y})`} onClick={() => p.onSelect(s.id)} style={{ cursor: "pointer" }}>
              <rect width={W} height={H} rx={10} fill={on ? "#1e1b26" : "#fff"} stroke={p.issueIds.has(s.id) ? "#dc2626" : on ? "#1e1b26" : "#d8d3e0"} strokeWidth={p.issueIds.has(s.id) ? 2 : 1} />
              {s.image?.url && <image href={s.image.url} x={4} y={4} width={28} height={38} preserveAspectRatio="xMidYMid slice" />}
              <text x={s.image?.url ? 38 : 10} y={19} fontSize={12} fontWeight={600} fill={on ? "#fff" : "#1e1b26"}>
                {(s.id === p.story.start ? "▶ " : "") + (s.name || `Scene ${i + 1}`).slice(0, 16)}
              </text>
              <text x={s.image?.url ? 38 : 10} y={35} fontSize={10} fill={on ? "#cfc8db" : "#7b7388"}>
                {s.route.type === "choices" ? `${s.route.options.length} choices` : s.route.type === "branch" ? `depends on ${s.route.flag || "…"}` : ends ? "■ end" : "continue"}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
    </div>
  );
}
