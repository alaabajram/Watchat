// Bot messages: edit every WhatsApp text, for all series or one series. Scenario switches live on each series page.

import Link from "next/link";
import { Flash } from "@/components/admin/Flash";
import { requireAdmin } from "@/lib/admin/auth";
import { COPY, COPY_KEYS } from "@/lib/bot/copy";
import { db } from "@/lib/supabase";
import { saveBotMessagesAction } from "../../bot-actions";

export const dynamic = "force-dynamic";

export default async function BotPage({ searchParams }: { searchParams: Promise<{ series?: string; ok?: string; err?: string }> }) {
  const admin = await requireAdmin("bot");
  const sp = await searchParams;
  const seriesId = sp.series && /^[0-9a-f-]{36}$/.test(sp.series) ? sp.series : null;

  const [{ data: seriesList }, { data: rows }] = await Promise.all([
    db().from("series").select("id, code, title_en").eq("tenant_id", admin.tenantId).order("created_at"),
    (() => {
      const q = db().from("bot_messages").select("key, lang, body").eq("tenant_id", admin.tenantId);
      return seriesId ? q.eq("series_id", seriesId) : q.is("series_id", null);
    })(),
  ]);
  const current = new Map((rows ?? []).map((r) => [`${r.key}.${r.lang}`, r.body as string]));

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h1>Bot messages & scenarios</h1>
        <Link className="btn" href={`/admin/bot/ai${seriesId ? `?series=${seriesId}` : ""}`}>
          ✨ Build with AI
        </Link>
      </div>
      <Flash ok={sp.ok} err={sp.err} />
      <div className="card">
        <p style={{ marginTop: 0 }}>
          Edit what the WhatsApp bot says. Leave a field empty to use the default (shown in grey). Placeholders:{" "}
          <code>{"{title}"}</code> series title · <code>{"{n}"}</code> episode · <code>{"{total}"}</code> episode count ·{" "}
          <code>{"{next}"}</code> next episode. Buttons are limited to 20 characters by WhatsApp.
        </p>
        <p className="muted" style={{ marginBottom: 0 }}>
          The chat scenario (language question, trailer, number of chat episodes, alerts question) is set per series on its{" "}
          <Link href="/admin/series">series page</Link>.
        </p>
      </div>
      <form method="get" className="row card">
        <label>
          Editing texts for
          <select name="series" defaultValue={seriesId ?? ""}>
            <option value="">All series (defaults)</option>
            {(seriesList ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                Only {s.code} · {s.title_en}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="secondary" style={{ alignSelf: "end" }}>
          Switch
        </button>
      </form>

      <form action={saveBotMessagesAction}>
        {seriesId && <input type="hidden" name="series_id" value={seriesId} />}
        <table className="card">
          <thead>
            <tr>
              <th style={{ width: 220 }}>Message</th>
              <th>Arabic</th>
              <th>English</th>
            </tr>
          </thead>
          <tbody>
            {COPY_KEYS.map((key) => {
              const entry = COPY[key];
              const isButton = entry.kind === "button";
              return (
                <tr key={key}>
                  <td>
                    <strong>{entry.label}</strong>
                    <div className="muted">{isButton ? "Button · max 20" : "Message"}</div>
                  </td>
                  {(["ar", "en"] as const).map((lang) =>
                    isButton ? (
                      <td key={lang}>
                        <input name={`${key}.${lang}`} dir={lang === "ar" ? "rtl" : "ltr"} maxLength={20} defaultValue={current.get(`${key}.${lang}`) ?? ""} placeholder={entry[lang]} style={{ width: "100%" }} />
                      </td>
                    ) : (
                      <td key={lang}>
                        <textarea name={`${key}.${lang}`} dir={lang === "ar" ? "rtl" : "ltr"} maxLength={1000} defaultValue={current.get(`${key}.${lang}`) ?? ""} placeholder={entry[lang]} />
                      </td>
                    ),
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        <p>
          <button type="submit">Save texts</button>
        </p>
      </form>
    </>
  );
}
