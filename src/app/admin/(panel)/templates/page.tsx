// WhatsApp templates: the only messages allowed outside a viewer's 24-hour chat window.
// Draft here → submit to Meta → sync status. Sequences and campaigns use APPROVED templates only.

import { Flash } from "@/components/admin/Flash";
import { UsageList } from "@/components/admin/TemplateEditor";
import { TemplatesEditorCard } from "@/components/admin/TemplatesEditorCard";
import { getTemplateForEdit, templateUsage } from "@/lib/messaging/template-store";
import { requireAdmin } from "@/lib/admin/auth";
import { db } from "@/lib/supabase";
import { wabaConfigured } from "@/lib/whatsapp/templates";
import {
  addStarterTemplatesAction,
  deleteTemplateAction,
  submitTemplateAction,
  syncTemplatesAction,
} from "../../messaging-actions";

export const dynamic = "force-dynamic";

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; edit?: string }> }) {
  const admin = await requireAdmin("messaging");
  const sp = await searchParams;
  const [{ data: templates }, usage, editing] = await Promise.all([
    db().from("wa_templates").select("*").eq("tenant_id", admin.tenantId).order("name").order("lang"),
    templateUsage(admin.tenantId),
    sp.edit ? getTemplateForEdit(admin.tenantId, sp.edit.slice(0, 100)) : Promise.resolve(null),
  ]);
  // One row per template name (Arabic + English together), like the editor.
  const byName = new Map<string, NonNullable<typeof templates>>();
  for (const t of templates ?? []) byName.set(t.name, [...(byName.get(t.name) ?? []), t]);
  const groups = [...byName.entries()];

  return (
    <>
      <h1>WhatsApp templates</h1>
      <Flash ok={sp.ok} err={sp.err} />
      <div className="card">
        <p style={{ marginTop: 0 }}>
          One library for the whole label: templates made or edited in the flow builder&apos;s Template card are the same ones listed here, and
          &quot;Used in&quot; shows every flow, sequence, campaign and growth-agent message that sends each one. Reminders and campaigns must use a
          template Meta has approved. In the body, <code>{"{{1}}"}</code> is the series title and{" "}
          <code>{"{{2}}"}</code> the episode number. A button opens the viewer&apos;s personal player link.
        </p>
        {!wabaConfigured() && (
          <p className="flash flash-err" style={{ marginBottom: 0 }}>
            Add <code>WHATSAPP_WABA_ID</code> (your Messaging account ID) in Vercel to submit and sync templates.
          </p>
        )}
        <div className="row">
          <form action={addStarterTemplatesAction}>
            <button type="submit" className="secondary">
              Add starter templates (resume, new series, win-back)
            </button>
          </form>
          <form action={syncTemplatesAction}>
            <button type="submit" className="secondary">
              Sync from Meta
            </button>
          </form>
        </div>
      </div>

      <table className="card">
        <thead>
          <tr>
            <th>Template</th>
            <th>Message</th>
            <th>Meta status</th>
            <th>Used in</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {groups.map(([name, rows]) => (
            <tr key={name} style={sp.edit === name ? { background: "#eef2ff" } : undefined}>
              <td>
                <code>{name}</code>
                <div className="muted">{rows[0].category}</div>
              </td>
              <td style={{ maxWidth: 380 }}>
                {rows.map((t) => (
                  <div key={t.id} dir={t.lang === "ar" ? "rtl" : "ltr"} style={{ whiteSpace: "pre-wrap", marginBottom: 6 }}>
                    <span className="muted">{t.lang.toUpperCase()} · </span>
                    {t.body}
                    {t.button_text && <div className="muted">🔗 {t.button_text}</div>}
                  </div>
                ))}
              </td>
              <td>
                {rows.map((t) => (
                  <div key={t.id} style={{ marginBottom: 4 }}>
                    <span className="muted">{t.lang.toUpperCase()} </span>
                    <span className={`badge ${t.meta_status}`}>{t.meta_status}</span>
                    {t.meta_reason && <div className="muted">{t.meta_reason}</div>}
                  </div>
                ))}
              </td>
              <td>
                <UsageList uses={usage.get(name) ?? []} />
              </td>
              <td>
                <div className="row">
                  <a className="abtn secondary" href={`/admin/templates?edit=${encodeURIComponent(name)}#editor`}>
                    Edit
                  </a>
                  {rows
                    .filter((t) => t.meta_status === "draft")
                    .map((t) => (
                      <form key={t.id} action={submitTemplateAction}>
                        <input type="hidden" name="id" value={t.id} />
                        <button type="submit">Submit {t.lang.toUpperCase()}</button>
                      </form>
                    ))}
                  {rows.map((t) => (
                    <form key={t.id} action={deleteTemplateAction}>
                      <input type="hidden" name="id" value={t.id} />
                      <button type="submit" className="secondary">
                        Remove {t.lang.toUpperCase()}
                      </button>
                    </form>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <TemplatesEditorCard editing={editing} uses={editing ? (usage.get(editing.name) ?? []) : []} />
    </>
  );
}
