"use client";

// Terms, Privacy and About: Arabic + English text with simple formatting and a live preview.

import { useState } from "react";
import { savePage } from "@/app/admin/site-actions";
import { PAGE_LABELS, PAGE_SLUGS, type PageSlug } from "@/lib/site/brand";
import type { SitePage } from "@/lib/site/store";
import { PageBody } from "@/components/site/PageBody";

export function SitePagesEditor({ pages, defaults }: { pages: Record<PageSlug, SitePage>; defaults: Partial<Record<PageSlug, { titleAr: string; titleEn: string; bodyAr: string; bodyEn: string }>> }) {
  const [slug, setSlug] = useState<PageSlug>("terms");
  const [all, setAll] = useState(pages);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const page = all[slug];
  const set = (patch: Partial<SitePage>) => setAll((x) => ({ ...x, [slug]: { ...x[slug], ...patch } }));
  const d = defaults[slug];

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 style={{ margin: 0 }}>Pages</h2>
      <div className="row">
        {PAGE_SLUGS.map((s) => (
          <button key={s} type="button" className={s === slug ? "" : "secondary"} onClick={() => (setSlug(s), setMsg(null))}>
            {PAGE_LABELS[s].en}
            {all[s].published ? " · live" : ""}
          </button>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>
        Shown at <a href={`/${slug}`} target="_blank" rel="noreferrer">/{slug}</a>
        {slug === "privacy" && !page.published ? " (until you publish, the built-in privacy notice is shown)" : ""}. Formatting: <code># Heading</code>,{" "}
        <code>## Subheading</code>, <code>- list item</code>, <code>**bold**</code>, <code>[link](https://…)</code>; a blank line starts a new paragraph.
        {d && !page.bodyAr && !page.bodyEn && (
          <>
            {" "}
            <button type="button" className="secondary" onClick={() => set(d)}>
              Start from the current text
            </button>
          </>
        )}
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label>
            Title · Arabic
            <input dir="rtl" value={page.titleAr} onChange={(e) => set({ titleAr: e.target.value })} placeholder={PAGE_LABELS[slug].ar} />
          </label>
          <label>
            Text · Arabic
            <textarea dir="rtl" rows={16} value={page.bodyAr} onChange={(e) => set({ bodyAr: e.target.value })} />
          </label>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label>
            Title · English
            <input value={page.titleEn} onChange={(e) => set({ titleEn: e.target.value })} placeholder={PAGE_LABELS[slug].en} />
          </label>
          <label>
            Text · English
            <textarea rows={16} value={page.bodyEn} onChange={(e) => set({ bodyEn: e.target.value })} />
          </label>
        </div>
      </div>

      <details>
        <summary>Preview</summary>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 8 }}>
          <div dir="rtl" style={{ background: "#fff", border: "1px solid var(--a-line)", borderRadius: 12, padding: 16 }}>
            <h1 style={{ marginTop: 0 }}>{page.titleAr || PAGE_LABELS[slug].ar}</h1>
            <PageBody text={page.bodyAr} />
          </div>
          <div dir="ltr" style={{ background: "#fff", border: "1px solid var(--a-line)", borderRadius: 12, padding: 16 }}>
            <h1 style={{ marginTop: 0 }}>{page.titleEn || PAGE_LABELS[slug].en}</h1>
            <PageBody text={page.bodyEn} />
          </div>
        </div>
      </details>

      <div className="row" style={{ alignItems: "center" }}>
        <label className="inline">
          <input type="checkbox" checked={page.published} onChange={(e) => set({ published: e.target.checked })} /> Published on the site
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setMsg(null);
            try {
              const r = await savePage(slug, page);
              setMsg({ ok: r.ok, text: r.message });
            } catch {
              setMsg({ ok: false, text: "Something went wrong. Try again." });
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Saving…" : `Save ${PAGE_LABELS[slug].en}`}
        </button>
        {msg && <span style={{ color: msg.ok ? "#166534" : "#b91c1c" }}>{msg.text}</span>}
      </div>
    </div>
  );
}
