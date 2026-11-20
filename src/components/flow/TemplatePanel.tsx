"use client";

// Template card editor: pick one of the label's WhatsApp templates, or write a new one right here.
// New templates are saved, sent to Meta for approval, and appear in the list straight away.

import { useMemo, useState } from "react";
import { addStarterTemplatesFromBuilder, createTemplateFromBuilder, refreshTemplates } from "@/app/admin/flow-actions";
import type { TemplateInfo } from "@/lib/flows/store";
import { OPT_OUT_AR, OPT_OUT_EN, templateIssues, templateSlug, type TemplateDraft } from "@/lib/whatsapp/template-rules";
import { EmojiField } from "./EmojiField";

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

function Bubble({ body, button, dir, title }: { body: string; button: string; dir: "rtl" | "ltr"; title: string }) {
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

export function TemplatePanel(p: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [writing, setWriting] = useState(false);
  const [draft, setDraft] = useState<TemplateDraft>({
    title: "",
    category: "marketing",
    ar: { body: "", button: "كمّل المشاهدة" },
    en: { body: "", button: "Continue watching" },
  });
  const current = p.templates.find((t) => t.name === p.value);
  const issues = useMemo(() => templateIssues({ ...draft, en: draft.en?.body.trim() ? draft.en : null }), [draft]);
  const tokens = (lang: "ar" | "en") => [
    { label: "Series title", text: "{{1}}" },
    { label: "Episode", text: "{{2}}" },
    { label: "Stop line", text: `\n\n${lang === "ar" ? OPT_OUT_AR : OPT_OUT_EN}` },
  ];

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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
      <div style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 8, padding: 8, fontSize: 12 }}>
        <strong>What&apos;s a template?</strong> A message you write and Meta approves (usually within minutes). WhatsApp only lets you message a viewer
        with an approved template once 24 hours have passed since their last message. [Series title] and [Episode] are filled in for each viewer, and the
        button opens their personal link.
      </div>

      {p.templates.length > 0 && (
        <label style={{ fontSize: 12 }}>
          Template
          <select value={p.value} onChange={(e) => p.onPick(e.target.value)}>
            <option value="">Pick a template</option>
            {p.templates.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name} · {statusOf(t.status).label}
              </option>
            ))}
          </select>
        </label>
      )}
      {current && (
        <>
          <span style={{ color: statusOf(current.status).color, fontSize: 12 }}>
            ● {statusOf(current.status).label}
            {current.status === "REJECTED" && (current.ar?.reason || current.en?.reason) ? ` · ${current.ar?.reason ?? current.en?.reason}` : ""}
          </span>
          {current.ar && <Bubble body={current.ar.body} button={current.ar.button ?? ""} dir="rtl" title={p.seriesTitle.ar} />}
        </>
      )}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button type="button" className={writing ? "secondary" : ""} onClick={() => setWriting(!writing)}>
          {writing ? "Close new template" : "+ New template"}
        </button>
        {p.templates.length === 0 && (
          <button type="button" className="secondary" disabled={busy !== null} onClick={() => run("starters", addStarterTemplatesFromBuilder)}>
            {busy === "starters" ? "Adding…" : "Add 3 starter templates"}
          </button>
        )}
        <button type="button" className="secondary" disabled={busy !== null} onClick={() => run("refresh", refreshTemplates)}>
          {busy === "refresh" ? "Checking…" : "↻ Check approval"}
        </button>
      </div>
      {message && <div style={{ color: message.ok ? "#166534" : "#b91c1c", fontSize: 12 }}>{message.text}</div>}

      {writing && (
        <div style={{ border: "1px solid #c7d2fe", borderRadius: 8, padding: 8, display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={{ fontSize: 12 }}>
            Name (for your team)
            <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Come back reminder" />
            {draft.title && <span className="muted">Saved as {templateSlug(draft.title)}</span>}
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 12 }}>
            <label className="inline">
              <input type="radio" checked={draft.category === "marketing"} onChange={() => setDraft({ ...draft, category: "marketing" })} /> Marketing: reminders,
              new episodes, offers (only to viewers with alerts on)
            </label>
            <label className="inline">
              <input type="radio" checked={draft.category === "utility"} onChange={() => setDraft({ ...draft, category: "utility" })} /> Utility: an update the viewer
              asked for (e.g. payment confirmed)
            </label>
          </div>

          <strong style={{ fontSize: 12 }}>Arabic</strong>
          <EmojiField rows={4} dir="rtl" value={draft.ar.body} onChange={(body) => setDraft({ ...draft, ar: { ...draft.ar, body } })} placeholder="اشتقنا لك! كمّل «…» من الحلقة …" tokens={tokens("ar")} />
          <EmojiField compact dir="rtl" value={draft.ar.button} onChange={(button) => setDraft({ ...draft, ar: { ...draft.ar, button } })} placeholder="Button (optional), max 25" maxLength={40} />
          <Bubble body={draft.ar.body} button={draft.ar.button} dir="rtl" title={p.seriesTitle.ar} />

          <strong style={{ fontSize: 12 }}>English (for viewers with English subtitles)</strong>
          <EmojiField rows={4} dir="ltr" value={draft.en?.body ?? ""} onChange={(body) => setDraft({ ...draft, en: { button: draft.en?.button ?? "", body } })} placeholder="We missed you! Continue …" tokens={tokens("en")} />
          <EmojiField compact value={draft.en?.button ?? ""} onChange={(button) => setDraft({ ...draft, en: { body: draft.en?.body ?? "", button } })} placeholder="Button (optional), max 25" maxLength={40} />

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
          <button
            type="button"
            disabled={busy !== null || issues.errors.length > 0}
            onClick={async () => {
              const r = await run("create", () => createTemplateFromBuilder({ ...draft, en: draft.en?.body.trim() ? draft.en : null }));
              if (r?.ok && r.name) {
                p.onPick(r.name);
                setWriting(false);
                setDraft({ title: "", category: "marketing", ar: { body: "", button: "كمّل المشاهدة" }, en: { body: "", button: "Continue watching" } });
              }
            }}
          >
            {busy === "create" ? "Sending to Meta…" : "Save & send to Meta"}
          </button>
        </div>
      )}
    </div>
  );
}
