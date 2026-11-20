"use client";

// Live WhatsApp preview of the flow, run by the same engine as the real bot.
// Tap the buttons to walk a branch; the preview replays your path after every edit.
// Change the sample viewer to see what a returning viewer, an English viewer, etc. would get.

import { useEffect, useRef, useState } from "react";
import { previewSkipWait, previewStart, previewTap, type PreviewItem, type PreviewSeries, type PreviewSession, type PreviewTemplates, type SampleViewer } from "@/lib/flows/preview";
import { parseButtonReplyId, type FlowGraph, type Lang } from "@/lib/flows/types";
import type { OutMessage } from "@/lib/whatsapp/messages";

type Tap = { nodeId: string; port: string; label: string };
type Props = {
  graph: FlowGraph;
  logicKey: string;
  series: PreviewSeries;
  templates: PreviewTemplates;
  code: string;
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
};

async function replay(g: FlowGraph, series: PreviewSeries, viewer: SampleViewer, templates: PreviewTemplates, code: string, path: Tap[]) {
  let s = await previewStart(g, series, viewer, templates, code);
  const kept: Tap[] = [];
  for (const t of path) {
    if (s.result.status === "wait") s = await previewSkipWait(g, s);
    if (s.result.status !== "input" || s.result.nodeId !== t.nodeId) break;
    s = await previewTap(g, s, t.nodeId, t.port, t.label);
    kept.push(t);
  }
  return { s, kept };
}

function Bubble({ item, current, selected, onTap, onSelect, lang }: { item: Extract<PreviewItem, { from: "bot" }>; current: boolean; selected: boolean; onTap: (id: string, title: string) => void; onSelect: () => void; lang: Lang }) {
  const m: OutMessage = item.msg;
  const media =
    m.kind === "video" || m.kind === "image" ? { type: m.kind, link: m.link } : (m.kind === "buttons" || m.kind === "cta_url") && m.header ? m.header : null;
  const body = m.kind === "video" || m.kind === "image" ? (m.caption ?? "") : m.kind === "template" ? `Template ${m.name}` : m.body;
  return (
    <div
      onClick={onSelect}
      style={{ alignSelf: "flex-start", maxWidth: "88%", background: "#fff", borderRadius: 8, boxShadow: selected ? "0 0 0 2px #2563eb" : "0 1px 1px #0002", cursor: "pointer", overflow: "hidden" }}
    >
      {media &&
        (media.type === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={media.link} alt="" style={{ width: "100%", maxHeight: 180, objectFit: "cover", display: "block" }} />
        ) : media.link.startsWith("https://preview.invalid") ? (
          <div style={{ height: 120, background: "#111", color: "#fff", display: "grid", placeItems: "center" }}>▶ video</div>
        ) : (
          <video src={media.link} controls playsInline preload="metadata" style={{ width: "100%", maxHeight: 220, background: "#000", display: "block" }} />
        ))}
      {body && (
        <div dir={lang === "ar" ? "rtl" : "ltr"} style={{ padding: "6px 9px", whiteSpace: "pre-wrap", fontSize: 14 }}>
          {body}
        </div>
      )}
      {m.kind === "buttons" &&
        m.buttons.map((b) => (
          <button
            key={b.id}
            type="button"
            disabled={!current}
            onClick={(e) => {
              e.stopPropagation();
              onTap(b.id, b.title);
            }}
            style={{ display: "block", width: "100%", background: "none", border: 0, borderTop: "1px solid #eef0f2", padding: 7, color: current ? "#027eb5" : "#8aa4b3", cursor: current ? "pointer" : "default", fontSize: 14 }}
          >
            {b.title}
          </button>
        ))}
      {m.kind === "cta_url" && <div style={{ borderTop: "1px solid #eef0f2", padding: 7, color: "#027eb5", textAlign: "center", fontSize: 14 }}>🔗 {m.buttonText}</div>}
      {m.kind === "list" && <div style={{ borderTop: "1px solid #eef0f2", padding: 7, color: "#027eb5", textAlign: "center", fontSize: 14 }}>☰ {m.buttonText}</div>}
    </div>
  );
}

export function ChatPreview(p: Props) {
  const [viewer, setViewer] = useState<SampleViewer>({ language: null, optIn: null, paid: false, reachedEpisode: 0, withinWindow: true });
  const [path, setPath] = useState<Tap[]>([]);
  const [session, setSession] = useState<PreviewSession | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const graphRef = useRef(p.graph);
  graphRef.current = p.graph;

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      const { s, kept } = await replay(graphRef.current, p.series, viewer, p.templates, p.code, path);
      if (cancelled) return;
      setSession(s);
      if (kept.length !== path.length) setPath(kept);
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.logicKey, viewer, path, p.series, p.templates, p.code]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [session]);

  const items = session?.items ?? [];
  const lastBotIndex = (() => {
    for (let i = items.length - 1; i >= 0; i--) if (items[i].from === "bot") return i;
    return -1;
  })();
  const inputNode = session?.result.status === "input" ? session.result.nodeId : null;
  const lang: Lang = session?.env.lang ?? "ar";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ padding: 8, borderBottom: "1px solid #e5e7eb", display: "flex", flexDirection: "column", gap: 6, fontSize: 12, background: "#fff" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <strong style={{ flex: 1 }}>Chat preview</strong>
          <button type="button" className="secondary" style={{ padding: "2px 8px", fontSize: 12 }} onClick={() => setPath([])}>
            ↺ Restart
          </button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          <select value={viewer.language ?? ""} onChange={(e) => (setViewer({ ...viewer, language: (e.target.value || null) as Lang | null }), setPath([]))} style={{ fontSize: 12 }}>
            <option value="">New viewer</option>
            <option value="ar">Arabic viewer</option>
            <option value="en">English-subtitles viewer</option>
          </select>
          <select value={viewer.optIn ?? ""} onChange={(e) => setViewer({ ...viewer, optIn: (e.target.value || null) as SampleViewer["optIn"] })} style={{ fontSize: 12 }}>
            <option value="">Alerts: not asked</option>
            <option value="in">Alerts: on</option>
            <option value="out">Alerts: off</option>
          </select>
          <label className="inline">
            <input type="checkbox" checked={viewer.paid} onChange={(e) => setViewer({ ...viewer, paid: e.target.checked })} /> Paid
          </label>
          <label className="inline">
            Reached ep{" "}
            <input type="number" min={0} max={p.series.episodeCount} value={viewer.reachedEpisode} onChange={(e) => setViewer({ ...viewer, reachedEpisode: Number(e.target.value) || 0 })} style={{ width: 48, fontSize: 12 }} />
          </label>
          <label className="inline" title="WhatsApp only allows templates once 24 hours pass after the viewer's last message">
            <input type="checkbox" checked={!viewer.withinWindow} onChange={(e) => setViewer({ ...viewer, withinWindow: !e.target.checked })} /> 24 h passed
          </label>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", background: "#efeae2", padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ alignSelf: "center", background: "#fff8", borderRadius: 6, padding: "2px 8px", fontSize: 11 }}>Watchat · {p.code}</div>
        {items.map((it, i) =>
          it.from === "viewer" ? (
            <div key={i} style={{ alignSelf: "flex-end", background: "#d9fdd3", borderRadius: 8, padding: "6px 9px", maxWidth: "80%", fontSize: 14 }} dir="auto">
              {it.text}
            </div>
          ) : it.from === "bot" ? (
            <Bubble
              key={i}
              item={it}
              lang={lang}
              current={i === lastBotIndex && inputNode === it.nodeId}
              selected={p.selectedNodeId === it.nodeId}
              onSelect={() => p.onSelectNode(it.nodeId)}
              onTap={(id, title) => {
                const parsed = parseButtonReplyId(id);
                if (parsed) setPath([...path, { ...parsed, label: title }]);
              }}
            />
          ) : (
            <div
              key={i}
              onClick={() => it.nodeId && p.onSelectNode(it.nodeId)}
              style={{ alignSelf: "center", background: it.text.startsWith("⛔") ? "#fee2e2" : "#e0f2fe", borderRadius: 8, padding: "4px 10px", fontSize: 12, textAlign: "center", maxWidth: "90%", cursor: it.nodeId ? "pointer" : "default" }}
              dir="auto"
            >
              {it.text}
              {session?.result.status === "wait" && i === items.length - 1 && (
                <button
                  type="button"
                  style={{ marginInlineStart: 8, padding: "0 8px", fontSize: 12 }}
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (session) setSession(await previewSkipWait(p.graph, session));
                  }}
                >
                  Skip wait ⏩
                </button>
              )}
            </div>
          ),
        )}
        <div ref={bottom} />
      </div>
    </div>
  );
}
