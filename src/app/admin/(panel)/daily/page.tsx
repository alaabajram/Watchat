// Admin → Daily: the horoscope desk (the AI drafts tomorrow's 12 readings; the team edits and approves; approved
// readings show from midnight Gulf time; without one a gentle stock line shows) and the Fortune Teller settings.

import Link from "next/link";
import { Flash } from "@/components/admin/Flash";
import { requireAdmin } from "@/lib/admin/auth";
import { addDays, playDay, SIGNS } from "@/lib/daily/daily";
import { playSettings } from "@/lib/play/store";
import { db } from "@/lib/supabase";
import { approveAllHoroscopesAction, draftHoroscopesAction, saveHoroscopeAction, savePlaySettingsAction } from "../../play-actions";

export const dynamic = "force-dynamic";

export default async function AdminDaily({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; day?: string }> }) {
  const admin = await requireAdmin("play");
  const sp = await searchParams;
  const today = playDay();
  const day = sp.day && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) ? sp.day : addDays(today, 1);
  const since = new Date(`${today}T00:00:00+04:00`).toISOString();
  const [settings, { data: rows }, { count: cards }, { count: answers }, { data: readings }, { count: streakers }] = await Promise.all([
    playSettings(admin.tenantId),
    db().from("horoscopes").select("*").eq("tenant_id", admin.tenantId).eq("day", day),
    db().from("daily_draws").select("viewer_id", { count: "exact", head: true }).eq("tenant_id", admin.tenantId).eq("day", today).eq("kind", "card"),
    db().from("daily_draws").select("viewer_id", { count: "exact", head: true }).eq("tenant_id", admin.tenantId).eq("day", today).eq("kind", "question"),
    db().from("tarot_readings").select("id").eq("tenant_id", admin.tenantId).gte("created_at", since),
    db().from("habit_days").select("viewer_id", { count: "exact", head: true }).eq("day", today),
  ]);
  const bySign = new Map((rows ?? []).map((r) => [r.sign as string, r]));
  const approved = (rows ?? []).filter((r) => r.status === "approved").length;
  const drafts = (rows ?? []).filter((r) => r.status === "draft").length;

  return (
    <>
      <h1>Daily</h1>
      <Flash ok={sp.ok} err={sp.err} />
      <p className="muted">
        Today ({today}): {cards ?? 0} cards drawn · {answers ?? 0} answered the daily question · {readings?.length ?? 0} paid readings · {streakers ?? 0} viewers active. Horoscopes and
        readings are shown as entertainment and personal reflection, never predictions.
      </p>

      <h2>Fortune Teller &amp; horoscope settings</h2>
      <form action={savePlaySettingsAction} className="card row" style={{ gap: 16, alignItems: "flex-end" }}>
        <input type="hidden" name="horoscope_form" value="1" />
        <label>
          Three-card reading price (Ping)
          <input name="reading_ping" type="number" min={0} max={10000} defaultValue={settings.readingPing} style={{ width: 100 }} />
        </label>
        <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <input type="checkbox" name="horoscope_auto_approve" defaultChecked={settings.horoscopeAutoApprove} />
          Publish AI horoscopes without review
        </label>
        <button type="submit">Save</button>
      </form>

      <h2>Horoscopes</h2>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        {[-1, 0, 1, 2, 3].map((n) => {
          const d = addDays(today, n);
          return (
            <Link key={d} href={`/admin/daily?day=${d}`} className={d === day ? "" : "muted"} style={{ fontWeight: d === day ? 700 : 400 }}>
              {n === 0 ? "Today" : n === 1 ? "Tomorrow" : d}
            </Link>
          );
        })}
      </div>
      <p>
        <strong>{day}</strong>: {approved}/12 approved{drafts ? ` · ${drafts} drafts waiting` : ""}. The scheduled run drafts tomorrow&apos;s readings automatically when
        the AI account is connected.
      </p>
      <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
        <form action={draftHoroscopesAction} className="row">
          <input type="hidden" name="day" value={day} />
          <input name="brief" placeholder="Optional theme, e.g. new month, Eid, weekend" style={{ width: 300 }} />
          <button type="submit">✨ Draft with AI</button>
        </form>
        {drafts ? (
          <form action={approveAllHoroscopesAction}>
            <input type="hidden" name="day" value={day} />
            <button type="submit" className="secondary">Approve all {drafts} drafts</button>
          </form>
        ) : null}
      </div>

      {SIGNS.map((s) => {
        const r = bySign.get(s.key);
        const ex = (r?.extra ?? {}) as { luckyNumber?: number; moodAr?: string; moodEn?: string };
        return (
          <details key={s.key} className="card" open={r?.status === "draft"}>
            <summary style={{ cursor: "pointer" }}>
              {s.symbol} <strong>{s.en}</strong> <span dir="rtl">· {s.ar}</span> · {r ? `${r.status}${r.source === "ai" ? " (AI)" : ""}` : <span className="muted">not written (stock line shows)</span>}
            </summary>
            <form action={saveHoroscopeAction} style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
              <input type="hidden" name="day" value={day} />
              <input type="hidden" name="sign" value={s.key} />
              <div className="row">
                <label style={{ flex: 1 }}>
                  Arabic
                  <textarea name="text_ar" rows={3} defaultValue={r?.text_ar ?? ""} dir="rtl" />
                </label>
                <label style={{ flex: 1 }}>
                  English
                  <textarea name="text_en" rows={3} defaultValue={r?.text_en ?? ""} />
                </label>
              </div>
              <div className="row">
                <label>
                  Lucky number
                  <input name="lucky" type="number" min={1} max={99} defaultValue={ex.luckyNumber ?? 7} style={{ width: 80 }} />
                </label>
                <label>
                  Mood (Arabic)
                  <input name="mood_ar" defaultValue={ex.moodAr ?? ""} dir="rtl" style={{ width: 140 }} />
                </label>
                <label>
                  Mood (English)
                  <input name="mood_en" defaultValue={ex.moodEn ?? ""} style={{ width: 140 }} />
                </label>
              </div>
              <div className="row">
                <button type="submit" name="intent" value="approve">Save &amp; approve</button>
                <button type="submit" name="intent" value="draft" className="secondary">Save as draft</button>
              </div>
            </form>
          </details>
        );
      })}
    </>
  );
}
