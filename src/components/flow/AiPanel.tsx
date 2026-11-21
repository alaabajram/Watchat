"use client";

// Build with AI on any flow canvas (series flows, sequence flows, shared replies). The draft replaces the canvas
// (cards you keep stay in place), the live preview updates, nothing goes live until Publish, and "Undo AI change"
// restores the canvas. It learns: rate a draft or tell it what to do differently, and what the team changes
// before publishing is noted too. Those become house rules, listed (and editable) under "What it has learned".

import { useEffect, useState, useTransition } from "react";
import { aiDraft, aiLessons, learnNow, rateAiDraft, saveAiLessons } from "@/app/admin/ai-flow-actions";
import type { Lesson } from "@/lib/ai/learning";
import type { FlowGraph, FlowKind } from "@/lib/flows/types";

type Props = {
  kind: FlowKind;
  /** Series id, sequence id, or "shared". */
  targetId: string;
  aiReady: boolean;
  graph: FlowGraph;
  onResult: (g: FlowGraph) => void;
  canUndo: boolean;
  onUndo: () => void;
};

const EXAMPLES: Record<FlowKind, string[]> = {
  series: [
    "Skip the language question, send the trailer, then episodes 1 and 2 with a strong cliffhanger before the link to episode 3.",
    "If they don't open the link, wait 2 hours and send a short teaser with a button to continue.",
    "After the link, wait 1 day; if alerts are on, send the come_back template.",
    "اجعل الرسائل أقصر وأكثر تشويقًا وأضف إيموجي مناسب",
  ],
  sequence: [
    "A day after they stop mid-series, send a reminder template; if they haven't come back 2 days later, send a last-chance offer, then end.",
    "When a viewer finishes a series, wait 6 hours and recommend another series with a template.",
    "For viewers inactive for 7 days: one gentle reminder, and stop if they come back or pay.",
  ],
  shared: [
    "Add a reply for «عروض» / OFFERS that explains the coin bundles and links to their account.",
    "Make the menu warmer and add a row «مسلسل جديد» that suggests a series they haven't started.",
    "If someone writes «شكرا» or THANKS, reply with a short friendly message and the menu button.",
    "اجعل رد الدعم أوضح واطلب من المشاهد كتابة رقم الحلقة ووصف المشكلة",
  ],
};

const WHAT: Record<FlowKind, string> = { series: "flow", sequence: "sequence", shared: "replies" };

export function AiPanel(p: Props) {
  const [request, setRequest] = useState("");
  const [mode, setMode] = useState<"change" | "new">("change");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ summary: string; notes: string; errors: string[]; draftId: string | null; lessonsUsed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!p.aiReady) {
    return (
      <div style={{ fontSize: 13 }}>
        <strong>AI isn&apos;t connected for this label.</strong>
        <p className="muted">
          The owner adds the label&apos;s Claude API key in <a href="/admin/ai">AI account</a>. Then describe what you want here and the AI draws it on the canvas.
        </p>
      </div>
    );
  }

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await aiDraft(p.kind, p.targetId, request, mode, p.graph);
      if (!r.ok) setError(r.error);
      else {
        p.onResult(r.graph);
        setResult({ summary: r.summary, notes: r.notes, errors: r.errors, draftId: r.draftId, lessonsUsed: r.lessonsUsed });
      }
    } catch {
      setError("AI request failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
      <div role="radiogroup" aria-label="What to do" style={{ display: "flex", gap: 4, background: "#f4f2ee", borderRadius: 12, padding: 3 }}>
        {(["change", "new"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => setMode(m)}
            style={{ flex: 1, border: 0, borderRadius: 10, padding: "6px 4px", fontSize: 12, fontWeight: 600, background: mode === m ? "#fff" : "transparent", color: "#1f1b24", boxShadow: mode === m ? "0 1px 3px #1f1b2420" : "none" }}
          >
            {m === "change" ? `Change this ${WHAT[p.kind]}` : `Start new`}
          </button>
        ))}
      </div>
      <textarea rows={6} value={request} onChange={(e) => setRequest(e.target.value)} maxLength={3000} placeholder="Describe it in Arabic or English…" dir="auto" aria-label="What should the AI do?" />
      <button type="button" disabled={busy || request.trim().length < 5} onClick={run}>
        {busy ? "Drafting… up to a minute" : "✨ Draft on canvas"}
      </button>
      {p.canUndo && !busy && (
        <button type="button" className="secondary" onClick={p.onUndo}>
          ↶ Undo AI change
        </button>
      )}
      {error && <div style={{ color: "#b42318" }}>{error}</div>}
      {result && (
        <div style={{ background: "#f7f5f2", borderRadius: 14, padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          <strong>Draft on the canvas · not live until you publish</strong>
          {result.summary && <span style={{ whiteSpace: "pre-wrap" }}>{result.summary}</span>}
          {result.notes && <span style={{ whiteSpace: "pre-wrap", color: "#92400e" }}>Note: {result.notes}</span>}
          {result.errors.length > 0 && (
            <span style={{ color: "#b42318" }}>{result.errors.length} problem(s) left for you to fix; they&apos;re marked on the cards and in Checks.</span>
          )}
          {result.lessonsUsed > 0 && <span className="muted" style={{ fontSize: 12 }}>Followed {result.lessonsUsed} house rule{result.lessonsUsed === 1 ? "" : "s"} it learned from your team.</span>}
          {result.draftId && <Feedback key={result.draftId} draftId={result.draftId} />}
        </div>
      )}
      <div className="muted" style={{ fontSize: 12 }}>
        Try:
        {EXAMPLES[p.kind].map((e) => (
          <a key={e} href="#" onClick={(ev) => (ev.preventDefault(), setRequest(e))} style={{ display: "block", marginTop: 4 }} dir="auto">
            “{e}”
          </a>
        ))}
      </div>
      <Learned kind={p.kind} />
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        Uses this label&apos;s own AI account. The AI only sees this canvas, its series details, media names and templates, never viewers&apos; phone numbers.
      </p>
    </div>
  );
}

/** 👍 / 👎 and "what should it do differently?" on a draft. */
function Feedback({ draftId }: { draftId: string }) {
  const [rating, setRating] = useState<1 | -1 | 0>(0);
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();
  const send = (r: 1 | -1 | 0, n: string) =>
    start(async () => {
      await rateAiDraft(draftId, r, n);
      setSent(true);
    });

  if (sent && !note) return <span style={{ fontSize: 12, color: "#0b7a52" }}>Thanks, noted. {rating === -1 ? "Tell it what to change next time below." : ""}</span>;
  return (
    <div style={{ borderTop: "1px solid #ece8e2", paddingTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ flex: 1, fontWeight: 600 }}>How was this draft?</span>
        {([1, -1] as const).map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={rating === r}
            aria-label={r === 1 ? "Good draft" : "Not good"}
            disabled={pending}
            onClick={() => {
              setRating(r);
              if (r === 1 && !note.trim()) send(1, "");
            }}
            style={{ background: rating === r ? (r === 1 ? "#e9fbf3" : "#fde4e1") : "#fff", color: "#1f1b24", border: "1px solid #ece8e2", borderRadius: 10, padding: "3px 10px", boxShadow: "none" }}
          >
            {r === 1 ? "👍" : "👎"}
          </button>
        ))}
      </div>
      {(rating === -1 || note) && !sent && (
        <>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="What should it do differently? e.g. shorter messages, less formal Arabic" dir="auto" aria-label="What should it do differently?" />
          <button type="button" disabled={pending || (!note.trim() && rating === 0)} onClick={() => send(rating, note)}>
            {pending ? "Sending…" : "Teach the AI"}
          </button>
        </>
      )}
      {sent && note && <span style={{ fontSize: 12, color: "#0b7a52" }}>Thanks. It&apos;s updating its house rules now.</span>}
    </div>
  );
}

/** The house rules it follows: learned from ratings, notes and edits, plus the team's own. Editable. */
function Learned({ kind }: { kind: FlowKind }) {
  const [rules, setRules] = useState<Lesson[] | null>(null);
  const [signals, setSignals] = useState(0);
  const [pendingSignals, setPendingSignals] = useState(0);
  const [draft, setDraft] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();

  useEffect(() => {
    let live = true;
    aiLessons(kind)
      .then((r) => {
        if (!live) return;
        setRules(r.rules);
        setSignals(r.signals);
        setPendingSignals(r.pending);
      })
      .catch(() => live && (setRules([]), setMsg("Couldn't load what it has learned. Reload to try again.")));
    return () => {
      live = false;
    };
  }, [kind]);

  const save = (next: Lesson[]) =>
    start(async () => {
      const r = await saveAiLessons(kind, next);
      setRules(r.rules);
    });

  return (
    <details style={{ borderTop: "1px solid #ece8e2", paddingTop: 8 }}>
      <summary style={{ cursor: "pointer", fontWeight: 700 }}>🧠 What it has learned{rules ? ` (${rules.length})` : ""}</summary>
      <p className="muted" style={{ fontSize: 12, margin: "6px 0" }}>
        House rules every draft on this kind of canvas follows. It learns them from your 👍/👎, your notes, and what you change in its drafts before
        publishing{kind === "series" ? ", and it sees which cards viewers tap most" : ""}. Edit or remove any rule; rules you add are always kept.
      </p>
      {rules === null ? (
        <span className="muted">Loading…</span>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {rules.length === 0 && <span className="muted" style={{ fontSize: 12 }}>Nothing yet. Rate a draft or publish one you edited, and it starts learning.</span>}
          {rules.map((l, i) => (
            <div key={`${i}-${l.text}`} style={{ display: "flex", gap: 6, alignItems: "flex-start", background: "#f7f5f2", borderRadius: 10, padding: "6px 8px" }}>
              <span title={l.source === "team" ? "Added by your team" : "Learned from your team's feedback and edits"} style={{ fontSize: 10, fontWeight: 700, borderRadius: 6, padding: "1px 6px", background: l.source === "team" ? "#e0f2fe" : "#e9fbf3", color: l.source === "team" ? "#075985" : "#0b7a52", flex: "none", marginTop: 2 }}>
                {l.source === "team" ? "TEAM" : "LEARNED"}
              </span>
              <span style={{ flex: 1, fontSize: 12.5 }} dir="auto">
                {l.text}
              </span>
              <button type="button" aria-label="Remove rule" disabled={busy} onClick={() => save(rules.filter((_, j) => j !== i))} style={{ background: "transparent", color: "#6b6474", padding: "0 4px", boxShadow: "none" }}>
                ✕
              </button>
            </div>
          ))}
          {rules.length < 12 && (
            <div style={{ display: "flex", gap: 6 }}>
              <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={220} placeholder="Add a rule, e.g. Always end with a question" dir="auto" style={{ flex: 1 }} aria-label="New rule" />
              <button
                type="button"
                disabled={busy || draft.trim().length < 3}
                onClick={() => {
                  save([...rules, { text: draft.trim(), source: "team", at: new Date().toISOString() }]);
                  setDraft("");
                }}
              >
                Add
              </button>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className="muted" style={{ fontSize: 11, flex: 1 }}>
              Learned from {signals} signal{signals === 1 ? "" : "s"}
              {pendingSignals ? ` · ${pendingSignals} new waiting` : ""}
            </span>
            <button
              type="button"
              className="secondary"
              disabled={busy || !pendingSignals}
              onClick={() =>
                start(async () => {
                  const r = await learnNow(kind);
                  setRules(r.rules);
                  if (r.learned) (setSignals((s) => s + r.learned), setPendingSignals(0));
                  setMsg(r.error ?? (r.learned ? `Updated from ${r.learned} new signal(s).` : "Nothing new to learn yet."));
                })
              }
              style={{ fontSize: 12, padding: "3px 10px" }}
            >
              {busy ? "Learning…" : "Learn now"}
            </button>
          </div>
          {msg && <span style={{ fontSize: 12 }} className="muted">{msg}</span>}
        </div>
      )}
    </details>
  );
}
