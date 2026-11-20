"use client";

// Template card editor: pick one of the label's WhatsApp templates, or write a new one right here.
// New templates are saved, sent to Meta for approval, and appear in the list straight away.

import { useState } from "react";
import { addStarterTemplatesFromBuilder, createTemplateFromBuilder, refreshTemplates, templateForEditFromBuilder, updateTemplateFromBuilder } from "@/app/admin/flow-actions";
import { TemplateBubble, TemplateEditor, UsageList } from "@/components/admin/TemplateEditor";
import type { TemplateForEdit, TemplateUse } from "@/lib/messaging/template-store";
import type { TemplateInfo } from "@/lib/flows/store";

type Props = {
  value: string;
  onPick: (name: string) => void;
  templates: TemplateInfo[];
  setTemplates: (t: TemplateInfo[]) => void;
  seriesTitle: { ar: string; en: string };
};

const STATUS: Record<string, { label: string; color: string }> = {
  APPROVED: { label: "approved", color: "#166534" },
  PENDING: { label: "waiting for Meta", color: "#854d0e" },
  REJECTED: { label: "rejected", color: "#b91c1c" },
  PAUSED: { label: "paused by Meta", color: "#b91c1c" },
  DISABLED: { label: "disabled by Meta", color: "#b91c1c" },
  draft: { label: "draft, not sent", color: "#475569" },
};
const statusOf = (s: string) => STATUS[s] ?? { label: s.toLowerCase(), color: "#475569" };

export function TemplatePanel(p: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [mode, setMode] = useState<"none" | "new" | "edit">("none");
  const [editing, setEditing] = useState<{ template: TemplateForEdit; uses: TemplateUse[] } | null>(null);
  const [uses, setUses] = useState<{ name: string; list: TemplateUse[] } | null>(null);
  const current = p.templates.find((t) => t.name === p.value);

  async function run(kind: string, fn: () => Promise<{ ok: boolean; templates: TemplateInfo[]; message?: string; name?: string }>) {
    setBusy(kind);
    setMessage(null);
    try {
      const r = await fn();
      p.setTemplates(r.templates);
      if (r.message) setMessage({ ok: r.ok, text: r.message });
      return r;
    } catch {
      setMessage({ ok: false, text: "Something went wrong. Try again." });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function openEdit() {
    if (!current) return;
    setBusy("load");
    try {
      const r = await templateForEditFromBuilder(current.name);
      if (!r.template) return setMessage({ ok: false, text: "Template not found." });
      setEditing({ template: r.template, uses: r.uses });
      setUses({ name: current.name, list: r.uses });
      setMode("edit");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
      <div style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 8, padding: 8, fontSize: 12 }}>
        <strong>What&apos;s a template?</strong> A message you write and Meta approves (usually within minutes). WhatsApp only lets you message a viewer
        with an approved template once 24 hours have passed since their last message. Templates live in one library: the ones you make or edit here are the
        same as on <a href="/admin/templates" target="_blank" rel="noreferrer">WhatsApp templates</a>, and sequences, campaigns and the growth agent can use them too.
      </div>

      {p.templates.length > 0 && (
        <label style={{ fontSize: 12 }}>
          Template
          <select
            value={p.value}
            onChange={(e) => {
              p.onPick(e.target.value);
              setMode("none");
              setUses(null);
            }}
          >
            <option value="">Pick a template</option>
            {p.templates.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name} · {statusOf(t.status).label}
              </option>
            ))}
          </select>
        </label>
      )}
      {current && mode !== "edit" && (
        <>
          <span style={{ color: statusOf(current.status).color, fontSize: 12 }}>
            ● {statusOf(current.status).label}
            {current.status === "REJECTED" && (current.ar?.reason || current.en?.reason) ? ` · ${current.ar?.reason ?? current.en?.reason}` : ""}
          </span>
          {current.ar && <TemplateBubble body={current.ar.body} button={current.ar.button ?? ""} dir="rtl" title={p.seriesTitle.ar} />}
          {uses?.name === current.name && (
            <div style={{ fontSize: 12 }}>
              <strong>Also used in</strong> <UsageList uses={uses.list} compact />
            </div>
          )}
        </>
      )}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {current && mode !== "edit" && (
          <button type="button" className="secondary" disabled={busy !== null} onClick={openEdit}>
            {busy === "load" ? "Opening…" : current.status === "REJECTED" ? "✎ Fix & resubmit" : "✎ Edit template"}
          </button>
        )}
        {mode !== "new" && (
          <button type="button" onClick={() => setMode("new")}>
            + New template
          </button>
        )}
        {p.templates.length === 0 && (
          <button type="button" className="secondary" disabled={busy !== null} onClick={() => run("starters", addStarterTemplatesFromBuilder)}>
            {busy === "starters" ? "Adding…" : "Add starter templates"}
          </button>
        )}
        <button type="button" className="secondary" disabled={busy !== null} onClick={() => run("refresh", refreshTemplates)}>
          {busy === "refresh" ? "Checking…" : "↻ Check approval"}
        </button>
      </div>
      {message && <div style={{ color: message.ok ? "#166534" : "#b91c1c", fontSize: 12 }}>{message.text}</div>}

      {mode === "new" && (
        <TemplateEditor
          seriesTitle={p.seriesTitle}
          onCancel={() => setMode("none")}
          onSave={async (draft) => {
            const r = await run("create", () => createTemplateFromBuilder(draft));
            if (r?.ok && r.name) {
              p.onPick(r.name);
              setMode("none");
            }
            return { ok: Boolean(r?.ok), message: r?.message };
          }}
        />
      )}
      {mode === "edit" && editing && (
        <TemplateEditor
          key={editing.template.name}
          seriesTitle={p.seriesTitle}
          initial={editing.template.draft}
          editing={{ name: editing.template.name, status: editing.template.status, categoryLocked: editing.template.categoryLocked, blocked: editing.template.blocked, uses: editing.uses }}
          onCancel={() => setMode("none")}
          onSave={async (draft) => {
            const r = await run("update", () => updateTemplateFromBuilder(editing.template.name, draft));
            if (r?.ok) setMode("none");
            return { ok: Boolean(r?.ok), message: r?.message };
          }}
        />
      )}
    </div>
  );
}
