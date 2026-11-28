// Admin → AI People: personality templates (name, look, personality, greeting, starter chips, free messages per
// day and Ping per extra message). House rules (always an AI, no advice that needs a professional, crisis
// care…) are added to every persona in code and can't be switched off here.

import { Flash } from "@/components/admin/Flash";
import { requireAdmin } from "@/lib/admin/auth";
import { playDay } from "@/lib/daily/daily";
import { ensureStarter, playSettings, toPerson, type PersonRow } from "@/lib/play/store";
import { db } from "@/lib/supabase";
import { addStarterPeopleAction, savePersonAction, savePlaySettingsAction } from "../../play-actions";

export const dynamic = "force-dynamic";

function PersonForm({ p }: { p?: PersonRow }) {
  return (
    <form action={savePersonAction} style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
      {p ? <input type="hidden" name="id" value={p.id} /> : null}
      <div className="row">
        {!p ? (
          <label>
            Address
            <input name="slug" pattern="[a-z0-9-]{2,40}" required dir="ltr" placeholder="e.g. uncle-sami" />
          </label>
        ) : null}
        <label>
          Status
          <select name="status" defaultValue={p?.status ?? "draft"}>
            <option value="draft">Draft (hidden)</option>
            <option value="live">Live</option>
          </select>
        </label>
        <label>
          Emoji
          <input name="emoji" defaultValue={p?.emoji ?? "🙂"} style={{ width: 70 }} />
        </label>
        <label>
          Colour
          <input name="color" type="color" defaultValue={p?.color ?? "#7c5cff"} />
        </label>
        <label>
          Order
          <input name="sort" type="number" defaultValue={p?.sort ?? 0} style={{ width: 80 }} />
        </label>
      </div>
      <div className="row">
        <label style={{ flex: 1 }}>
          Name (Arabic)
          <input name="name_ar" defaultValue={p?.nameAr} dir="rtl" required />
        </label>
        <label style={{ flex: 1 }}>
          Name (English)
          <input name="name_en" defaultValue={p?.nameEn} required />
        </label>
      </div>
      <div className="row">
        <label style={{ flex: 1 }}>
          One line (Arabic)
          <input name="role_ar" defaultValue={p?.roleAr} dir="rtl" />
        </label>
        <label style={{ flex: 1 }}>
          One line (English)
          <input name="role_en" defaultValue={p?.roleEn} />
        </label>
      </div>
      <label>
        Personality (who they are, how they talk, what they like to do in a chat)
        <textarea name="persona" rows={4} defaultValue={p?.persona} required />
      </label>
      <div className="row">
        <label style={{ flex: 1 }}>
          Greeting (Arabic — must say «ذكاء اصطناعي»)
          <textarea name="greeting_ar" rows={2} defaultValue={p?.greetingAr} dir="rtl" />
        </label>
        <label style={{ flex: 1 }}>
          Greeting (English — must say “AI”)
          <textarea name="greeting_en" rows={2} defaultValue={p?.greetingEn} />
        </label>
      </div>
      <label>
        Starter chips, one per line: Arabic | English
        <textarea name="starters" rows={3} defaultValue={p?.starters.map((s) => `${s.ar} | ${s.en}`).join("\n")} />
      </label>
      <div className="row">
        <label>
          Free messages per day
          <input name="free_per_day" type="number" min={0} max={500} defaultValue={p?.freePerDay ?? 10} style={{ width: 90 }} />
        </label>
        <label>
          Ping per extra message
          <input name="ping_per_message" type="number" min={0} max={1000} defaultValue={p?.pingPerMessage ?? 1} style={{ width: 90 }} />
        </label>
      </div>
      <div>
        <button type="submit">{p ? "Save" : "Create AI person"}</button>
      </div>
    </form>
  );
}

export default async function AdminPeople({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const admin = await requireAdmin("play");
  const sp = await searchParams;
  await ensureStarter(admin.tenantId);
  const since = new Date(`${playDay()}T00:00:00+04:00`).toISOString();
  const [{ data }, settings, { count: aiToday }, { data: chats }] = await Promise.all([
    db().from("ai_people").select("*").eq("tenant_id", admin.tenantId).order("sort"),
    playSettings(admin.tenantId),
    db().from("ai_usage").select("id", { count: "exact", head: true }).eq("tenant_id", admin.tenantId).eq("purpose", "ai_people").gte("created_at", since),
    db().from("ai_chats").select("person_id").eq("tenant_id", admin.tenantId).gte("updated_at", since),
  ]);
  const people = (data ?? []).map(toPerson);
  const active = new Map<string, number>();
  for (const c of chats ?? []) active.set(c.person_id as string, (active.get(c.person_id as string) ?? 0) + 1);
  return (
    <>
      <h1>AI People</h1>
      <Flash ok={sp.ok} err={sp.err} />
      <p className="muted">
        AI characters viewers chat with. Every one is labelled as AI on the site and follows the house rules (no human pretence, no professional
        advice, crisis care, no romance, politics or religion). Chats are kept 30 days. Today: {aiToday ?? 0} AI replies of the daily cap of{" "}
        {settings.peopleDailyAiCap} (shared with Fortune Teller readings; when the cap is reached, characters say they&apos;re taking a break).
      </p>
      <form action={savePlaySettingsAction} className="row" style={{ marginBottom: 16 }}>
        <input type="hidden" name="back" value="people" />
        <label>
          Daily AI cap (AI People + readings)
          <input name="people_daily_ai_cap" type="number" min={0} max={1000000} defaultValue={settings.peopleDailyAiCap} style={{ width: 120 }} />
        </label>
        <button type="submit" className="secondary">Save cap</button>
      </form>
      {people.map((p) => (
        <details key={p.id} className="card">
          <summary style={{ cursor: "pointer" }}>
            {p.emoji} <strong>{p.nameEn}</strong> <span dir="rtl">· {p.nameAr}</span> · {p.status} · {p.freePerDay} free/day, then {p.pingPerMessage} Ping · {active.get(p.id) ?? 0} chats today
          </summary>
          <PersonForm p={p} />
        </details>
      ))}
      <form action={addStarterPeopleAction} style={{ margin: "12px 0" }}>
        <button type="submit" className="secondary">Add the seven starter AI people (skips any you already have)</button>
      </form>
      <h2>New AI person</h2>
      <div className="card">
        <PersonForm />
      </div>
    </>
  );
}
