"use client";

// One card on the canvas, drawn like the WhatsApp message it sends. Each button / choice has its own
// connection dot on the right; drag from it to the next card.

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { formatMinutes } from "@/lib/flows/preview";
import { CARD_LABELS, portsOf, type NodeData } from "@/lib/flows/types";
import { CARD_STYLE } from "./cards";

export type CardNodeData = { card: NodeData; thumb: string | null; errors: number; warnings: number; templateBody?: string | null };
export type CardFlowNode = Node<CardNodeData, "card">;

const CONDITION_TEXT = {
  opted_in: "Viewer turned on alerts?",
  language_en: "Viewer watches with English subtitles?",
  paid: "Viewer has paid before?",
  reached_episode: "Viewer reached episode",
} as const;

function summary(d: NodeData, templateBody?: string | null): { text: string; dir: "rtl" | "ltr" } {
  switch (d.kind) {
    case "start":
      return { text: "Viewer sends the series code", dir: "ltr" };
    case "message":
      return { text: d.body.ar || d.body.en || (d.media ? "" : "(empty message)"), dir: "rtl" };
    case "language":
      return { text: d.body.ar, dir: "rtl" };
    case "episode":
      return { text: `Episode ${d.episode} · ${d.caption.ar}`, dir: "rtl" };
    case "link":
      return { text: `${d.episode === "resume" ? "Where they left off" : `Episode ${d.episode}`} · ${d.body.ar}`, dir: "rtl" };
    case "optin":
      return { text: d.body.ar, dir: "rtl" };
    case "wait":
      return { text: `Wait ${formatMinutes(d.minutes)}`, dir: "ltr" };
    case "condition":
      return { text: d.condition.check === "reached_episode" ? `${CONDITION_TEXT.reached_episode} ${d.condition.episode}?` : CONDITION_TEXT[d.condition.check], dir: "ltr" };
    case "template":
      return { text: d.name ? `${d.name}${templateBody ? ` · ${templateBody}` : ""}` : "(pick a template)", dir: d.name && templateBody ? "rtl" : "ltr" };
    case "suggest":
      return { text: "Other series list", dir: "ltr" };
  }
}

export function CardNode({ data, selected }: NodeProps<CardFlowNode>) {
  const d = data.card;
  const style = CARD_STYLE[d.kind];
  const s = summary(d, data.templateBody);
  const ports = portsOf(d);
  const isVideo = (d.kind === "message" || d.kind === "language") && d.media?.type === "video";

  return (
    <div
      style={{
        width: 250,
        background: "#fff",
        borderRadius: 10,
        border: `2px solid ${selected ? style.color : data.errors ? "#dc2626" : "#e5e7eb"}`,
        boxShadow: selected ? `0 0 0 3px ${style.color}33` : "0 1px 3px #0001",
        fontSize: 12,
      }}
    >
      {d.kind !== "start" && <Handle type="target" position={Position.Left} style={{ top: 18, width: 10, height: 10, background: "#94a3b8" }} />}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", background: style.color, color: "#fff", borderRadius: "7px 7px 0 0" }}>
        <span>{style.icon}</span>
        <strong style={{ flex: 1 }}>{CARD_LABELS[d.kind].split(":")[0]}</strong>
        {data.errors > 0 && <span title="Errors" style={{ background: "#dc2626", borderRadius: 8, padding: "0 6px" }}>{data.errors}</span>}
        {!data.errors && data.warnings > 0 && <span title="Warnings" style={{ background: "#f59e0b", borderRadius: 8, padding: "0 6px" }}>{data.warnings}</span>}
      </div>
      <div style={{ padding: 8, background: d.kind === "wait" || d.kind === "condition" ? "#f8fafc" : "#efeae2" }}>
        <div style={{ background: "#fff", borderRadius: 8, padding: 6, boxShadow: "0 1px 1px #0001" }}>
          {data.thumb &&
            (isVideo ? (
              <div style={{ height: 70, background: "#111", color: "#fff", borderRadius: 6, display: "grid", placeItems: "center", marginBottom: 4 }}>▶ video</div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.thumb} alt="" style={{ width: "100%", height: 80, objectFit: "cover", borderRadius: 6, marginBottom: 4 }} />
            ))}
          {d.kind === "episode" && !data.thumb && (
            <div style={{ height: 50, background: "#111", color: "#fff", borderRadius: 6, display: "grid", placeItems: "center", marginBottom: 4 }}>🎬 Episode {d.episode}</div>
          )}
          <div dir={s.dir} style={{ whiteSpace: "pre-wrap", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", color: "#111" }}>
            {s.text}
          </div>
        </div>
      </div>
      {ports.map((p) => (
        <div key={p.id} style={{ position: "relative", borderTop: "1px solid #f1f5f9", padding: "5px 18px 5px 10px", color: "#0369a1", textAlign: "center" }} dir="auto">
          {p.label}
          <Handle type="source" id={p.id} position={Position.Right} style={{ width: 10, height: 10, background: style.color }} />
        </div>
      ))}
      {ports.length === 0 && <div style={{ padding: "4px 10px", color: "#64748b", textAlign: "center", borderTop: "1px solid #f1f5f9" }}>Ends the flow</div>}
    </div>
  );
}
