"use client";

// Build with AI inside the flow builder. The draft replaces the canvas (cards you keep stay in place),
// the live preview updates, nothing goes live until Publish, and "Undo AI change" restores the canvas.

import { useState } from "react";
import { aiDraftFlow } from "@/app/admin/flow-actions";
import type { FlowGraph } from "@/lib/flows/types";

type Props = {
  seriesId: string;
  aiReady: boolean;
  graph: FlowGraph;
  onResult: (g: FlowGraph) => void;
  canUndo: boolean;
  onUndo: () => void;
};

const EXAMPLES = [
  "Skip the language question, send the trailer, then episodes 1 and 2 with a strong cliffhanger before the link to episode 3.",
  "If they don't open the link, wait 2 hours and send a short teaser with a button to continue.",
  "After the link, wait 1 day; if alerts are on, send the come_back template.",
  "اجعل الرسائل أقصر وأكثر تشويقًا وأضف إيموجي مناسب",
];

export function AiPanel(p: Props) {
  const [request, setRequest] = useState("");
  const [mode, setMode] = useState<"change" | "new">("change");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ summary: string; notes: string; errors: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!p.aiReady) {
    return (
      <div style={{ fontSize: 13 }}>
        <strong>AI isn&apos;t connected for this label.</strong>
        <p className="muted">
          The owner adds the label&apos;s Claude API key in <a href="/admin/ai">AI account</a>. Then describe a flow here and the AI draws it on the canvas.
        </p>
      </div>
    );
  }

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await aiDraftFlow(p.seriesId, request, mode, p.graph);
      if (!r.ok) setError(r.error);
      else {
        p.onResult(r.graph);
        setResult({ summary: r.summary, notes: r.notes, errors: r.errors });
      }
    } catch {
      setError("AI request failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label className="inline">
          <input type="radio" checked={mode === "change"} onChange={() => setMode("change")} /> Change the current flow
        </label>
        <label className="inline">
          <input type="radio" checked={mode === "new"} onChange={() => setMode("new")} /> Start a new flow
        </label>
      </div>
      <textarea rows={6} value={request} onChange={(e) => setRequest(e.target.value)} maxLength={3000} placeholder="Describe the chat in Arabic or English…" dir="auto" />
      <button type="button" disabled={busy || request.trim().length < 5} onClick={run}>
        {busy ? "Drafting… up to a minute" : "✨ Draft on canvas"}
      </button>
      {p.canUndo && !busy && (
        <button type="button" className="secondary" onClick={p.onUndo}>
          ↶ Undo AI change
        </button>
      )}
      {error && <div style={{ color: "#b91c1c" }}>{error}</div>}
      {result && (
        <div style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 8, padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          <strong>Draft on the canvas · not live until you publish</strong>
          {result.summary && <span style={{ whiteSpace: "pre-wrap" }}>{result.summary}</span>}
          {result.notes && <span style={{ whiteSpace: "pre-wrap", color: "#92400e" }}>Note: {result.notes}</span>}
          {result.errors.length > 0 && (
            <span style={{ color: "#b91c1c" }}>
              {result.errors.length} problem(s) left for you to fix; they&apos;re marked on the cards and in Checks.
            </span>
          )}
        </div>
      )}
      <div className="muted" style={{ fontSize: 12 }}>
        Try:
        {EXAMPLES.map((e) => (
          <a key={e} href="#" onClick={(ev) => (ev.preventDefault(), setRequest(e))} style={{ display: "block", marginTop: 4 }} dir="auto">
            “{e}”
          </a>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        Uses this label&apos;s own AI account. The AI only sees this series&apos; flow, episodes, media names and templates.
      </p>
    </div>
  );
}
