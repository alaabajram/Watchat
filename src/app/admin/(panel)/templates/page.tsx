// WhatsApp templates: the only messages allowed outside a viewer's 24-hour chat window.
// Draft here → submit to Meta → sync status. Sequences and campaigns use APPROVED templates only.

import { Flash } from "@/components/admin/Flash";
import { requireAdmin } from "@/lib/admin/auth";
import { db } from "@/lib/supabase";
import { wabaConfigured } from "@/lib/whatsapp/templates";
import {
  addStarterTemplatesAction,
  deleteTemplateAction,
  saveTemplateAction,
  submitTemplateAction,
  syncTemplatesAction,
} from "../../messaging-actions";

export const dynamic = "force-dynamic";

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const admin = await requireAdmin("messaging");
  const sp = await searchParams;
  const { data: templates } = await db().from("wa_templates").select("*").eq("tenant_id", admin.tenantId).order("name").order("lang");

  return (
    <>
      <h1>WhatsApp templates</h1>
      <Flash ok={sp.ok} err={sp.err} />
      <div className="card">
        <p style={{ marginTop: 0 }}>
          Reminders and campaigns must use a template Meta has approved. In the body, <code>{"{{1}}"}</code> is the series title and{" "}
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
            <th>Name</th>
            <th>Lang</th>
            <th>Category</th>
            <th>Body</th>
            <th>Button</th>
            <th>Meta status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {(templates ?? []).map((t) => (
            <tr key={t.id}>
              <td>
                <code>{t.name}</code>
              </td>
              <td>{t.lang}</td>
              <td>{t.category}</td>
              <td dir={t.lang === "ar" ? "rtl" : "ltr"} style={{ whiteSpace: "pre-wrap", maxWidth: 360 }}>
                {t.body}
              </td>
              <td>{t.button_text ?? "—"}</td>
              <td>
                <span className={`badge ${t.meta_status}`}>{t.meta_status}</span>
                {t.meta_reason && <div className="muted">{t.meta_reason}</div>}
              </td>
              <td>
                <div className="row">
                  {(t.meta_status === "draft" || t.meta_status === "REJECTED") && (
                    <form action={submitTemplateAction}>
                      <input type="hidden" name="id" value={t.id} />
                      <button type="submit">Submit to Meta</button>
                    </form>
                  )}
                  <form action={deleteTemplateAction}>
                    <input type="hidden" name="id" value={t.id} />
                    <button type="submit" className="secondary">
                      Remove
                    </button>
                  </form>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form action={saveTemplateAction} className="card">
        <h2 style={{ marginTop: 0 }}>New or edit template</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Same name + language overwrites the draft. Approved templates can&apos;t be edited on Meta: create a new name instead.
        </p>
        <div className="grid3">
          <label>
            Name
            <input name="name" placeholder="resume_reminder" pattern="[a-z0-9_]+" required />
          </label>
          <label>
            Language
            <select name="lang">
              <option value="ar">Arabic</option>
              <option value="en">English</option>
            </select>
          </label>
          <label>
            Category
            <select name="category">
              <option value="marketing">Marketing (reminders, offers, new series)</option>
              <option value="utility">Utility (account / purchase updates)</option>
            </select>
          </label>
          <label>
            Header
            <select name="header_type">
              <option value="none">None</option>
              <option value="image">Series poster (create in WhatsApp Manager)</option>
            </select>
          </label>
          <label>
            Button text (opens personal link)
            <input name="button_text" maxLength={25} placeholder="Continue watching" />
          </label>
        </div>
        <label style={{ marginTop: 12 }}>
          Body
          <textarea name="body" maxLength={1024} required placeholder="You stopped at episode {{2}} of “{{1}}”…" />
        </label>
        <p>
          <button type="submit">Save draft</button>
        </p>
      </form>
    </>
  );
}
