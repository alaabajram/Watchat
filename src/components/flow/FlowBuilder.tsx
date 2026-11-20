"use client";

// The visual flow builder: cards on a canvas linked by arrows, a card editor, the series media library,
// and a live WhatsApp preview that always shows how the chat will look. Autosaves the draft;
// "Publish" checks the flow and makes it live for new and continuing chats.

import "@xyflow/react/dist/style.css";
import {
  addEdge,
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { checkFlow, deleteMyCard, loadVersion, publishFlow, renameMyCard, saveFlowDraft, saveMyCards, standardFlow } from "@/app/admin/flow-actions";
import { newId } from "@/lib/flows/defaults";
import type { BuilderData, SavedCard } from "@/lib/flows/store";
import { artUrl } from "@/lib/flows/meta";
import { CARD_LABELS, portsOf, type FlowGraph, type MediaRef, type NodeData, type NodeKind } from "@/lib/flows/types";
import { validateFlow, type Issue } from "@/lib/flows/validate";
import { AiPanel } from "./AiPanel";
import { ADDABLE, CARD_STYLE, newCard } from "./cards";
import { CardNode, type CardFlowNode } from "./CardNode";
import { ChatPreview } from "./ChatPreview";
import { Inspector } from "./Inspector";
import { MediaLibrary } from "./MediaLibrary";

const nodeTypes = { card: CardNode };
const edgeDefaults = { type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed, color: "#64748b" }, style: { stroke: "#64748b", strokeWidth: 2 } };

function toFlow(g: FlowGraph): { nodes: CardFlowNode[]; edges: Edge[] } {
  return {
    nodes: g.nodes.map((n) => ({ id: n.id, type: "card", position: n.position, deletable: n.data.kind !== "start", data: { card: n.data, name: n.name, thumb: null, errors: 0, warnings: 0 } })),
    edges: g.edges.map((e) => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle, target: e.target, ...edgeDefaults })),
  };
}

function toGraph(nodes: CardFlowNode[], edges: Edge[]): FlowGraph {
  return {
    v: 1,
    nodes: nodes.map((n) => ({ id: n.id, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) }, data: n.data.card, ...(n.data.name?.trim() ? { name: n.data.name.trim() } : {}) })),
    edges: edges.filter((e) => e.sourceHandle).map((e) => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle!, target: e.target })),
  };
}

export function FlowBuilder(props: BuilderData & { canPublish: boolean }) {
  return (
    <ReactFlowProvider>
      <Builder {...props} />
    </ReactFlowProvider>
  );
}

function Builder(props: BuilderData & { canPublish: boolean }) {
  const initial = useMemo(() => toFlow(props.draft), [props.draft]);
  const [nodes, setNodes, onNodesChange] = useNodesState<CardFlowNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<"cards" | "media" | "ai">("cards");
  const [undo, setUndo] = useState<FlowGraph | null>(null);
  const [assets, setAssets] = useState(props.assets);
  const [templates, setTemplates] = useState(props.templates);
  const [myCards, setMyCards] = useState<SavedCard[]>(props.myCards);
  const [blockName, setBlockName] = useState("");
  const [published, setPublished] = useState(props.published);
  const [versions, setVersions] = useState(props.versions);
  const [saveState, setSaveState] = useState<{ at: string | null; busy: boolean; error?: string }>({ at: props.draftUpdatedAt, busy: false });
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [note, setNote] = useState("");
  const [showIssues, setShowIssues] = useState(false);
  const flow = useReactFlow();
  const canvas = useRef<HTMLDivElement>(null);

  const graph = useMemo(() => toGraph(nodes, edges), [nodes, edges]);
  const logicKey = useMemo(() => JSON.stringify({ n: graph.nodes.map((n) => [n.id, n.data]), e: graph.edges }), [graph]);
  const fullKey = useMemo(() => JSON.stringify(graph), [graph]);
  // Compare against the canvas's own serialization so opening the builder never counts as a change.
  const savedKey = useRef(JSON.stringify(toGraph(initial.nodes, initial.edges)));
  const dirty = fullKey !== savedKey.current;

  const templateBodies = useMemo(() => Object.fromEntries(templates.map((t) => [t.name, t.bodyAr ?? ""])), [templates]);
  const previewTemplates = useMemo(
    () =>
      Object.fromEntries(
        templates.map((t) => [
          t.name,
          { approved: t.approved, ar: t.ar ? { body: t.ar.body, button: t.ar.button } : null, en: t.en ? { body: t.en.body, button: t.en.button } : null },
        ]),
      ),
    [templates],
  );
  const issues = useMemo(
    () =>
      validateFlow(graph, {
        episodeCount: props.series.episodeCount,
        templates: templates.map((t) => ({ name: t.name, approved: t.approved })),
        seriesCodes: (props.series.others ?? []).map((o) => o.code),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [logicKey, props.series.episodeCount, templates],
  );
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");

  const cmsItems = useMemo(() => {
    const art = props.series.art;
    const items: { key: string; label: string; url: string; type: "image" | "video"; ref: MediaRef }[] = [];
    const add = (key: string, label: string, url: string | null | undefined, type: "image" | "video", ref: MediaRef) => url && items.push({ key, label, url, type, ref });
    add("wa", "WhatsApp banner", art?.bannerWa, "image", { source: "series", slot: "banner_wa", type: "image" });
    add("poster", "Poster", props.series.posterUrl, "image", { source: "series", slot: "poster", type: "image" });
    add("square", "Square", art?.square, "image", { source: "series", slot: "square", type: "image" });
    add("wide", "Wide banner", art?.bannerWide, "image", { source: "series", slot: "banner_wide", type: "image" });
    add("trailer", "Trailer", props.series.trailerUrl, "video", { source: "trailer", type: "video" });
    for (const [n, c] of Object.entries(props.series.clips)) add(`ep${n}`, `Episode ${n} clip`, c.ar ?? c.en, "video", { source: "episode", episode: Number(n), type: "video" });
    return items;
  }, [props.series]);

  const mediaThumb = (m: MediaRef): string | null => {
    if ("assetId" in m) return m.url;
    if (m.source === "episode") return props.series.clips[m.episode]?.ar ?? null;
    if (m.source === "series") return artUrl({ poster: props.series.posterUrl, bannerWa: props.series.art?.bannerWa ?? null, bannerWide: props.series.art?.bannerWide ?? null, square: props.series.art?.square ?? null }, m.slot);
    return m.source === "poster" ? props.series.posterUrl : props.series.trailerUrl;
  };

  // Badges, thumbnails and template text on the cards.
  useEffect(() => {
    setNodes((ns) =>
      ns.map((n) => {
        const d = n.data.card;
        const media = "media" in d ? d.media : null;
        const thumb = media ? mediaThumb(media) : null;
        const e = issues.filter((i) => i.nodeId === n.id && i.level === "error").length;
        const w = issues.filter((i) => i.nodeId === n.id && i.level === "warning").length;
        const templateBody = d.kind === "template" ? (templateBodies[d.name] ?? null) : undefined;
        if (n.data.thumb === thumb && n.data.errors === e && n.data.warnings === w && n.data.templateBody === templateBody) return n;
        return { ...n, data: { ...n.data, thumb, errors: e, warnings: w, templateBody } };
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issues, setNodes, props.series, templateBodies]);

  // Autosave the draft 2 s after the last change.
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(async () => {
      setSaveState((s) => ({ ...s, busy: true }));
      const snapshot = fullKey;
      const r = await saveFlowDraft(props.seriesId, JSON.parse(snapshot));
      if (r.ok) {
        savedKey.current = snapshot;
        setSaveState({ at: r.savedAt, busy: false });
      } else setSaveState((s) => ({ ...s, busy: false, error: r.error }));
    }, 2000);
    return () => clearTimeout(t);
  }, [fullKey, dirty, props.seriesId]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (fullKey !== savedKey.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [fullKey]);

  const onConnect = useCallback(
    (c: Connection) =>
      setEdges((es) => addEdge({ ...c, id: newId(), ...edgeDefaults }, es.filter((e) => !(e.source === c.source && e.sourceHandle === c.sourceHandle)))),
    [setEdges],
  );

  const updateCard = (id: string, data: NodeData) => {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, card: data } } : n)));
    const ports = new Set(portsOf(data).map((p) => p.id));
    setEdges((es) => es.filter((e) => e.source !== id || ports.has(e.sourceHandle ?? "")));
  };

  const addCard = (kind: NodeKind) => {
    const rect = canvas.current?.getBoundingClientRect();
    const center = flow.screenToFlowPosition({ x: (rect?.left ?? 0) + (rect?.width ?? 800) / 2 - 125, y: (rect?.top ?? 0) + (rect?.height ?? 600) / 3 });
    const id = newId();
    setNodes((ns) => [
      ...ns.map((n) => ({ ...n, selected: false })),
      { id, type: "card", position: { x: center.x + (ns.length % 5) * 20, y: center.y + (ns.length % 5) * 20 }, selected: true, data: { card: newCard(kind, props.series.episodeCount), thumb: null, errors: 0, warnings: 0 } },
    ]);
    setSelected(id);
  };

  /** Save cards (and the arrows between them) to My cards. */
  const saveToMyCards = async (ids: string[], name: string) => {
    const set = new Set(ids);
    const block = { v: 1, nodes: graph.nodes.filter((n) => set.has(n.id)), edges: graph.edges.filter((e) => set.has(e.source) && set.has(e.target)) };
    const r = await saveMyCards(name, block);
    setMyCards(r.cards);
    setMessage({ kind: r.ok ? "ok" : "err", text: r.message });
    return r.ok;
  };

  /** Drop a My cards block below the flow with fresh ids, selected, and move the view to it. */
  const insertBlock = (c: SavedCard) => {
    const at = nodes.length ? { x: Math.min(...nodes.map((n) => n.position.x)), y: Math.max(...nodes.map((n) => n.position.y)) + 420 } : { x: 0, y: 0 };
    const w = Math.max(...c.block.nodes.map((n) => n.position.x)) + 250;
    setTimeout(() => flow.setCenter(at.x + w / 2, at.y + 150, { zoom: Math.max(flow.getZoom(), 0.8), duration: 300 }), 50);
    const ids = new Map(c.block.nodes.map((n) => [n.id, newId()]));
    setNodes((ns) => [
      ...ns.map((n) => ({ ...n, selected: false })),
      ...c.block.nodes.map((n) => ({
        id: ids.get(n.id)!,
        type: "card" as const,
        position: { x: at.x + n.position.x, y: at.y + n.position.y },
        selected: true,
        data: { card: n.data, name: n.name, thumb: null, errors: 0, warnings: 0 },
      })),
    ]);
    setEdges((es) => [...es, ...c.block.edges.map((e) => ({ id: newId(), source: ids.get(e.source)!, sourceHandle: e.sourceHandle, target: ids.get(e.target)!, ...edgeDefaults }))]);
    setSelected(c.block.nodes.length === 1 ? ids.get(c.block.nodes[0].id)! : null);
    setMessage({ kind: "ok", text: `Added "${c.name}". Connect it to your flow with arrows.` });
  };

  const focusCard = (id: string) => {
    setSelected(id);
    setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === id })));
    const n = flow.getNode(id);
    if (n) flow.setCenter(n.position.x + 125, n.position.y + 100, { zoom: Math.max(flow.getZoom(), 0.9), duration: 300 });
  };

  const replaceGraph = (g: FlowGraph, opts: { fit?: boolean } = {}) => {
    const f = toFlow(g);
    setNodes(f.nodes);
    setEdges(f.edges);
    setSelected(null);
    if (opts.fit !== false) setTimeout(() => flow.fitView({ duration: 300, maxZoom: 1 }), 50);
  };

  const multi = nodes.filter((n) => n.selected && n.data.card.kind !== "start");
  const selectedNode = multi.length > 1 ? null : (nodes.find((n) => n.id === selected) ?? null);
  const selectedTakesMedia = selectedNode && "media" in selectedNode.data.card;

  async function onPublish() {
    setMessage(null);
    const r = await publishFlow(props.seriesId, graph, note);
    if (!r.ok) {
      setShowIssues(true);
      setMessage({ kind: "err", text: r.error ?? `Fix ${r.issues.filter((i) => i.level === "error").length} problem(s) before publishing.` });
      return;
    }
    savedKey.current = fullKey;
    setSaveState({ at: new Date().toISOString(), busy: false });
    setPublished({ versionId: r.versionId, version: r.version, graph });
    setVersions([{ id: r.versionId, version: r.version, publishedAt: new Date().toISOString(), note: note || null }, ...versions]);
    setNote("");
    setMessage({ kind: "ok", text: `Published version ${r.version}. New chats for ${props.code} follow this flow now.` });
  }

  const time = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }) : "");
  const publishedDiffers = published && JSON.stringify({ n: published.graph.nodes.map((n) => [n.id, n.data]), e: published.graph.edges }) !== logicKey;

  return (
    <div className="flow-builder" style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 24px)", gap: 8 }}>
      {/* Toolbar */}
      <div className="card" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: "8px 12px", margin: 0 }}>
        <strong>
          {props.code} · {props.series.titleEn}
        </strong>
        <span className="muted" style={{ fontSize: 13 }}>
          {published ? `Live: version ${published.version}${publishedDiffers ? " · draft has unpublished changes" : ""}` : "Not published yet · new chats get the standard flow"}
        </span>
        <span className="muted" style={{ fontSize: 13 }}>
          {saveState.busy ? "Saving…" : saveState.error ? `Save failed: ${saveState.error}` : dirty ? "Unsaved changes" : `Draft saved ${time(saveState.at)}`}
        </span>
        <span style={{ flex: 1 }} />
        <button type="button" className="secondary" onClick={() => setShowIssues(!showIssues)} style={{ color: errors.length ? "#b91c1c" : undefined }}>
          {errors.length ? `⛔ ${errors.length}` : "✓"} {warnings.length ? `⚠️ ${warnings.length}` : ""} Checks
        </button>
        <select
          value=""
          onChange={async (e) => {
            const v = e.target.value;
            e.target.value = "";
            if (v === "standard") {
              if (!confirm("Replace the draft with the standard scenario built from this series' settings and texts?")) return;
              const g = await standardFlow(props.seriesId);
              if (g) replaceGraph(g);
            } else if (v) {
              if (!confirm("Load this version into the draft? Your current draft will be replaced (it isn't live until you publish).")) return;
              const g = await loadVersion(props.seriesId, v);
              if (g) replaceGraph(g);
            }
          }}
        >
          <option value="">Versions & more…</option>
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              Load v{v.version} · {time(v.publishedAt)}
              {v.note ? ` · ${v.note}` : ""}
            </option>
          ))}
          <option value="standard">Start from the standard scenario</option>
        </select>
        {props.canPublish && (
          <>
            <input placeholder="What changed? (optional)" value={note} onChange={(e) => setNote(e.target.value)} style={{ width: 180 }} />
            <button type="button" onClick={onPublish} disabled={errors.length > 0} title={errors.length ? "Fix the problems first" : "Make this flow live"}>
              Publish
            </button>
          </>
        )}
      </div>
      {message && (
        <div className="card" style={{ margin: 0, padding: "6px 12px", color: message.kind === "ok" ? "#166534" : "#b91c1c" }}>
          {message.text}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "250px 1fr 370px", gap: 8 }}>
        {/* Left: add cards / media library */}
        <div className="card" style={{ margin: 0, padding: 8, overflowY: "auto" }}>
          <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
            <button type="button" className={tab === "cards" ? "" : "secondary"} style={{ flex: 1, padding: 4 }} onClick={() => setTab("cards")}>
              Add card
            </button>
            <button type="button" className={tab === "media" ? "" : "secondary"} style={{ flex: 1, padding: 4 }} onClick={() => setTab("media")}>
              Media ({assets.length})
            </button>
            <button type="button" className={tab === "ai" ? "" : "secondary"} style={{ flex: 1, padding: 4 }} onClick={() => setTab("ai")}>
              ✨ AI
            </button>
          </div>
          {tab === "ai" ? (
            <AiPanel
              seriesId={props.seriesId}
              aiReady={props.aiReady}
              graph={graph}
              canUndo={Boolean(undo)}
              onUndo={() => {
                if (undo) replaceGraph(undo);
                setUndo(null);
              }}
              onResult={(g) => {
                setUndo(graph);
                replaceGraph(g);
              }}
            />
          ) : tab === "cards" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {ADDABLE.map((k) => (
                <button
                  key={k}
                  type="button"
                  className="secondary"
                  onClick={() => addCard(k)}
                  title={CARD_STYLE[k].help}
                  style={{ textAlign: "left", padding: "6px 8px", borderLeft: `4px solid ${CARD_STYLE[k].color}` }}
                >
                  {CARD_STYLE[k].icon} {CARD_LABELS[k]}
                </button>
              ))}
              <p className="muted" style={{ fontSize: 12 }}>
                Drag from a button&apos;s dot on the right of a card to another card to connect them. Select a card or arrow and press Delete to remove it.
                Shift-drag on the canvas to select several cards.
              </p>
              <strong style={{ marginTop: 4 }}>☆ My cards</strong>
              {myCards.length === 0 && (
                <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                  Save any card (or a group of connected cards) with &quot;Save to My cards&quot; to reuse it in every series.
                </p>
              )}
              {myCards.map((c) => (
                <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 4, border: "1px solid #e5e7eb", borderRadius: 8, padding: "4px 6px", background: "#fff" }}>
                  <button type="button" className="secondary" style={{ flex: 1, textAlign: "left", border: 0, padding: "2px 4px" }} onClick={() => insertBlock(c)} title="Add to the canvas">
                    <span dir="auto">{c.name}</span>
                    <span className="muted" style={{ display: "block", fontSize: 11, fontWeight: 400 }}>
                      {c.block.nodes.map((n) => CARD_STYLE[n.data.kind].icon).join(" ")} · {c.cardCount} card{c.cardCount === 1 ? "" : "s"}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    title="Rename"
                    style={{ padding: "0 6px", border: 0 }}
                    onClick={async () => {
                      const name = prompt("New name", c.name);
                      if (name?.trim()) setMyCards(await renameMyCard(c.id, name));
                    }}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    title="Delete from My cards"
                    style={{ padding: "0 6px", border: 0 }}
                    onClick={async () => {
                      if (confirm(`Delete "${c.name}" from My cards? Cards already on canvases stay.`)) setMyCards(await deleteMyCard(c.id));
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <MediaLibrary
              seriesId={props.seriesId}
              assets={assets}
              setAssets={setAssets}
              graph={graph}
              publishedGraph={published?.graph ?? null}
              canAttach={Boolean(selectedTakesMedia)}
              onAttach={(a) => {
                if (!selectedNode) return;
                const d = selectedNode.data.card;
                if (d.kind === "link" && a.kind === "video") return setMessage({ kind: "err", text: "Web link cards can only show an image." });
                if ("media" in d) updateCard(selectedNode.id, { ...d, media: { assetId: a.id, url: a.url, type: a.kind, name: a.name } } as NodeData);
              }}
              onShowCard={focusCard}
              cms={cmsItems}
              onAttachRef={(ref) => {
                if (!selectedNode) return;
                const d = selectedNode.data.card;
                if (d.kind === "link" && ref.type === "video") return setMessage({ kind: "err", text: "Web link cards can only show an image." });
                if ("media" in d) updateCard(selectedNode.id, { ...d, media: ref } as NodeData);
              }}
            />
          )}
        </div>

        {/* Canvas */}
        <div ref={canvas} className="card" style={{ margin: 0, padding: 0, position: "relative", overflow: "hidden" }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, n) => setSelected(n.id)}
            onPaneClick={() => setSelected(null)}
            onNodesDelete={(del) => del.some((n) => n.id === selected) && setSelected(null)}
            deleteKeyCode={["Backspace", "Delete"]}
            fitView
            fitViewOptions={{ maxZoom: 1, padding: 0.1 }}
            minZoom={0.2}
          >
            <Background gap={20} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeColor={(n) => CARD_STYLE[(n.data as CardFlowNode["data"]).card.kind].color} />
          </ReactFlow>

          {selectedNode && (
            <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: 340, background: "#fff", borderLeft: "1px solid #e5e7eb", padding: 12, overflowY: "auto", zIndex: 5, boxShadow: "-4px 0 12px #0001" }}>
              <Inspector
                seriesId={props.seriesId}
                nodeId={selectedNode.id}
                data={selectedNode.data.card}
                onChange={(d) => updateCard(selectedNode.id, d)}
                onDelete={() => {
                  setNodes((ns) => ns.filter((n) => n.id !== selectedNode.id));
                  setEdges((es) => es.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id));
                  setSelected(null);
                }}
                onClose={() => setSelected(null)}
                assets={assets}
                addAsset={(a) => setAssets((list) => [a, ...list])}
                templates={templates}
                setTemplates={setTemplates}
                series={props.series}
                issues={issues.filter((i) => i.nodeId === selectedNode.id)}
                name={selectedNode.data.name ?? ""}
                onRename={(name) => setNodes((ns) => ns.map((n) => (n.id === selectedNode.id ? { ...n, data: { ...n.data, name } } : n)))}
                onSaveToMyCards={() => {
                  const fallback = selectedNode.data.name?.trim() || CARD_LABELS[selectedNode.data.card.kind];
                  const name = prompt("Name in My cards", fallback);
                  if (name?.trim()) void saveToMyCards([selectedNode.id], name);
                }}
              />
            </div>
          )}

          {multi.length > 1 && (
            <div style={{ position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)", zIndex: 7, background: "#fff", border: "1px solid #c7d2fe", borderRadius: 10, padding: "6px 8px", display: "flex", gap: 6, alignItems: "center", boxShadow: "0 4px 12px #0002", fontSize: 13 }}>
              <strong>{multi.length} cards selected</strong>
              <input value={blockName} onChange={(e) => setBlockName(e.target.value)} placeholder="Name, e.g. Reminder after 2 h" style={{ width: 200 }} dir="auto" />
              <button
                type="button"
                disabled={!blockName.trim()}
                onClick={async () => {
                  if (await saveToMyCards(multi.map((n) => n.id), blockName)) setBlockName("");
                }}
              >
                ☆ Save to My cards
              </button>
              <button
                type="button"
                className="secondary"
                style={{ color: "#b91c1c" }}
                onClick={() => {
                  const ids = new Set(multi.map((n) => n.id));
                  setNodes((ns) => ns.filter((n) => !ids.has(n.id)));
                  setEdges((es) => es.filter((e) => !ids.has(e.source) && !ids.has(e.target)));
                }}
              >
                Delete
              </button>
            </div>
          )}

          {showIssues && (
            <div style={{ position: "absolute", left: 8, bottom: 8, maxWidth: 520, maxHeight: "45%", overflowY: "auto", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: 8, zIndex: 6, fontSize: 13, boxShadow: "0 4px 12px #0002" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <strong>{issues.length ? "Checks before publishing" : "All checks pass ✓"}</strong>
                <button type="button" className="secondary" style={{ padding: "0 6px" }} onClick={() => setShowIssues(false)}>
                  ✕
                </button>
              </div>
              {issues.map((i: Issue, k) => (
                <div key={k} onClick={() => i.nodeId && focusCard(i.nodeId)} style={{ cursor: i.nodeId ? "pointer" : "default", padding: "2px 0", color: i.level === "error" ? "#b91c1c" : "#b45309" }}>
                  {i.level === "error" ? "⛔" : "⚠️"} {i.message}
                </div>
              ))}
              <button
                type="button"
                className="secondary"
                style={{ marginTop: 6, padding: "2px 8px", fontSize: 12 }}
                onClick={async () => {
                  const server = await checkFlow(props.seriesId, graph);
                  setMessage({ kind: server.some((i) => i.level === "error") ? "err" : "ok", text: server.length ? `Server check: ${server.length} item(s), same as listed.` : "Server check passed ✓" });
                }}
              >
                Re-check with latest templates
              </button>
            </div>
          )}
        </div>

        {/* Right: live preview, always visible */}
        <div className="card" style={{ margin: 0, padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <ChatPreview graph={graph} logicKey={logicKey} series={props.series} templates={previewTemplates} code={props.code} selectedNodeId={selected} onSelectNode={focusCard} />
        </div>
      </div>
    </div>
  );
}
