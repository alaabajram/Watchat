"use client";

// One WhatsApp template editor, used on the WhatsApp templates page and on the flow builder's Template card.
// Arabic + English together, live WhatsApp preview, Meta's rules checked as you type. Editing a template
// changes it everywhere it is used (flows, sequences, campaigns, growth agent).

import { useMemo, useState } from "react";
import { EmojiField } from "@/components/flow/EmojiField";
import type { TemplateUse } from "@/lib/messaging/template-store";
import { OPT_OUT_AR, OPT_OUT_EN, templateIssues, templateSlug, type TemplateDraft } from "@/lib/whatsapp/template-rules";

export const EMPTY_TEMPLATE: TemplateDraft = {
  title: "",
  category: "marketing",
  ar: { body: "", button: "كمّل المشاهدة" },
  en: { body: "", button: "Continue watching" },
};

export function TemplateBubble({ body, button, dir, title }: { body: string; button: string; dir: "rtl" | "ltr"; title: string }) {
  const text = body.replace(/\{\{1\}\}/g, title).replace(/\{\{2\}\}/g, "4");
  return (
    <div style={{ background: "#efeae2", padding: 8, borderRadius: 8 }}>
      <div style={{ background: "#fff", borderRadius: 8, boxShadow: "0 1px 1px #0002", maxWidth: 260 }} dir={dir}>
        <div style={{ padding: "6px 9px", whiteSpace: "pre-wrap", fontSize: 13 }}>{text || "…"}</div>
        {button.trim() && <div style={{ borderTop: "1px solid #eef0f2", padding: 6, color: "#027eb5", textAlign: "center", fontSize: 13 }}>🔗 {button}</div>}
      </div>
    </div>
  );
}

export function UsageList({ uses, compact = false }: { uses: TemplateUse[]; compact?: boolean }) {
  if (!uses.length) return <span className="muted" style={{ fontSize: 12 }}>Not used anywhere yet</span>;
  return (
    <ul style={{ margin: 0, paddingInlineStart: compact ? 14 : 18, fontSize: 12 }}>
      {uses.map((u) => (
        <li key={`${u.kind}:${u.href}:${u.label}`}>
          <a href={u.href} target={compact ? "_blank" : undefined} rel="noreferrer">
            {u.label}
          </a>
          {!u.active && <span className="muted"> · not sending</span>}
        </li>
      ))}
    </ul>
  );
}

type Props = {
  /** Editing an existing template (name fixed) or writing a new one. */
  editing?: { name: string; status: string; categoryLocked: boolean; blocked: string | null; uses: TemplateUse[] } | null;
  initial?: TemplateDraft;
  seriesTitle?: { ar: string; en: string };
  onSave: (draft: TemplateDraft) => Promise<{ ok: boolean; message?: string }>;
  onCancel?: () => void;
};

export function TemplateEditor({ editing, initial, seriesTitle = { ar: "أسرار البيت", en: "House Secrets" }, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState<TemplateDraft>(initial ?? EMPTY_TEMPLATE);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const clean = { ...draft, title: editing ? editing.name : draft.title, en: draft.en?.body.trim() ? draft.en : null };
  const issues = useMemo(() => templateIssues(clean), [clean]); // eslint-disable-line react-hooks/exhaustive-deps
  const live = editing?.uses.filter((u) => u.active) ?? [];
  const tokens = (lang: "ar" | "en") => [
    { label: "Series title", text: "{{1}}" },
    { label: "Episode", text: "{{2}}" },
    { label: "Stop line", text: `\n\n${lang === "ar" ? OPT_OUT_AR : OPT_OUT_EN}` },
  ];

  if (editing?.blocked) return <p className="muted" style={{ fontSize: 13 }}>{editing.blocked}</p>;

  return (
    <div style={{ border: "1px solid #c7d2fe", borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
      {editing ? (
        <>
          <strong>
            Edit <code>{editing.name}</code>
          </strong>
          {editing.status === "APPROVED" && (
            <span style={{ color: "#b45309", fontSize: 12 }}>
              ⚠️ Saving sends it back to Meta for review. Meta allows one edit a day (ten a month) on an approved template, and its category can&apos;t change.
            </span>
          )}
          <div style={{ fontSize: 12 }}>
            <strong>Used in</strong> (changes apply to all of these): <UsageList uses={editing.uses} compact />
          </div>
          {live.length > 1 && <span style={{ fontSize: 12, color: "#b45309" }}>Tip: to change it for one place only, create a new template instead.</span>}
        </>
      ) : (
        <label style={{ fontSize: 12 }}>
          Name (for your team)
          <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Come back reminder" />
          {draft.title && <span className="muted">Saved as {templateSlug(draft.title)}</span>}
        </label>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 12 }}>
        <label className="inline">
          <input type="radio" disabled={editing?.categoryLocked} checked={draft.category === "marketing"} onChange={() => setDraft({ ...draft, category: "marketing" })} /> Marketing:
          reminders, new episodes, offers (only to viewers with alerts on)
        </label>
        <label className="inline">
          <input type="radio" disabled={editing?.categoryLocked} checked={draft.category === "utility"} onChange={() => setDraft({ ...draft, category: "utility" })} /> Utility: an
          update the viewer asked for (e.g. payment confirmed)
        </label>
      </div>

      <strong style={{ fontSize: 12 }}>Arabic</strong>
      <EmojiField rows={4} dir="rtl" value={draft.ar.body} onChange={(body) => setDraft({ ...draft, ar: { ...draft.ar, body } })} placeholder="اشتقنا لك! كمّل «…» من الحلقة …" tokens={tokens("ar")} />
      <EmojiField compact dir="rtl" value={draft.ar.button} onChange={(button) => setDraft({ ...draft, ar: { ...draft.ar, button } })} placeholder="Button (optional), max 25" maxLength={40} />
      <TemplateBubble body={draft.ar.body} button={draft.ar.button} dir="rtl" title={seriesTitle.ar} />

      <strong style={{ fontSize: 12 }}>English (for viewers with English subtitles)</strong>
      <EmojiField rows={4} dir="ltr" value={draft.en?.body ?? ""} onChange={(body) => setDraft({ ...draft, en: { button: draft.en?.button ?? "", body } })} placeholder="We missed you! Continue …" tokens={tokens("en")} />
      <EmojiField compact value={draft.en?.button ?? ""} onChange={(button) => setDraft({ ...draft, en: { body: draft.en?.body ?? "", button } })} placeholder="Button (optional), max 25" maxLength={40} />
      {draft.en?.body.trim() && <TemplateBubble body={draft.en.body} button={draft.en.button} dir="ltr" title={seriesTitle.en} />}

      {issues.errors.map((e) => (
        <div key={e} style={{ color: "#b91c1c", fontSize: 12 }}>
          ⛔ {e}
        </div>
      ))}
      {issues.warnings.map((w) => (
        <div key={w} style={{ color: "#b45309", fontSize: 12 }}>
          ⚠️ {w}
        </div>
      ))}
      {message && <div style={{ color: message.ok ? "#166534" : "#b91c1c", fontSize: 12 }}>{message.text}</div>}
      <div style={{ display: "flex", gap: 6 }}>
        <button
          type="button"
          disabled={busy || issues.errors.length > 0}
          onClick={async () => {
            if (editing && live.length > 0 && !confirm(`This template is sending from ${live.length} place(s). Change it everywhere?`)) return;
            setBusy(true);
            setMessage(null);
            try {
              const r = await onSave(clean);
              if (r.message) setMessage({ ok: r.ok, text: r.message });
              if (r.ok && !editing) setDraft(EMPTY_TEMPLATE);
            } catch {
              setMessage({ ok: false, text: "Something went wrong. Try again." });
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Sending to Meta…" : editing ? "Save changes & send to Meta" : "Save & send to Meta"}
        </button>
        {onCancel && (
          <button type="button" className="secondary" onClick={onCancel}>
            Close
          </button>
        )}
      </div>
    </div>
  );
}
