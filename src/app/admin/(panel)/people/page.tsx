// Admin → AI People: personality templates (name, look, personality, greeting, starter chips, free messages per
// day and Ping per extra message). House rules (always an AI, no advice that needs a professional, crisis
// care…) are added to every persona in code and can't be switched off here.

import { Flash } from "@/components/admin/Flash";
import { ImageField } from "@/components/admin/ImageField";
import { statsText } from "@/lib/people/card";
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
      <div className="row" style={{ alignItems: "flex-start", gap: 20 }}>
        <ImageField name="image_path" label="Portrait" hint="Square works best. Without one, the emoji shows." path={p?.imagePath ?? null} url={p?.image ?? null} ratio="1 / 1" />
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label>
            Label (Arabic), e.g. «الأخت الكبيرة»
            <input name="tag_ar" defaultValue={p?.tagAr} dir="rtl" maxLength={40} />
          </label>
          <label>
            Label (English), e.g. “Big sister”
            <input name="tag_en" defaultValue={p?.tagEn} maxLength={40} />
          </label>
        </div>
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
      <fieldset style={{ border: "1px solid var(--a-line, #ddd)", borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        <legend>
          <strong>Heroes page card</strong>
        </legend>
        <div className="row" style={{ alignItems: "flex-start", gap: 20 }}>
          <ImageField name="voice_path" kind="audio" label="Voice note" hint="Plays on the card (MP3 / M4A, under 5 MB)." path={p?.voicePath ?? null} url={p?.voice ?? null} />
          <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
            <div className="row">
              <label style={{ flex: 1 }}>
                Group (Arabic) — the filter tab
                <input name="group_ar" defaultValue={p?.card.groupAr} dir="rtl" maxLength={30} />
              </label>
              <label style={{ flex: 1 }}>
                Group (English), e.g. “Mythic &amp; story”
                <input name="group_en" defaultValue={p?.card.groupEn} maxLength={30} />
              </label>
            </div>
            <div className="row">
              <label style={{ flex: 1 }}>
                Class line (Arabic)
                <input name="kicker_ar" defaultValue={p?.card.kickerAr} dir="rtl" maxLength={40} />
              </label>
              <label style={{ flex: 1 }}>
                Class line (English), e.g. “Class A • Mint”
                <input name="kicker_en" defaultValue={p?.card.kickerEn} maxLength={40} />
              </label>
            </div>
          </div>
        </div>
        <div className="row">
          <label style={{ flex: 1 }}>
            Subtitle (Arabic)
            <input name="subtitle_ar" defaultValue={p?.card.subtitleAr} dir="rtl" maxLength={60} />
          </label>
          <label style={{ flex: 1 }}>
            Subtitle (English), e.g. “Brutally honest big sister”
            <input name="subtitle_en" defaultValue={p?.card.subtitleEn} maxLength={60} />
          </label>
        </div>
        <div className="row">
          <label>
            Portrait badge (Arabic)
            <input name="badge_ar" defaultValue={p?.card.badgeAr} dir="rtl" maxLength={16} style={{ width: 120 }} />
          </label>
          <label>
            Portrait badge (English), shown as “Lv.N HONEST”
            <input name="badge_en" defaultValue={p?.card.badgeEn} maxLength={16} style={{ width: 120 }} />
          </label>
          <label>
            Chip emoji
            <input name="feature_emoji" defaultValue={p?.card.featureEmoji} style={{ width: 70 }} />
          </label>
          <label style={{ flex: 1 }}>
            Chip (Arabic)
            <input name="feature_ar" defaultValue={p?.card.featureAr} dir="rtl" maxLength={40} />
          </label>
          <label style={{ flex: 1 }}>
            Chip (English), e.g. “Derby debate active”
            <input name="feature_en" defaultValue={p?.card.featureEn} maxLength={40} />
          </label>
        </div>
        <label>
          Stats, up to three, one per line: Arabic label | English label | value
          <textarea name="stats" rows={3} defaultValue={p ? statsText(p.card.stats) : ""} placeholder={"الحدس | Intuition | 98%"} />
        </label>
        <div className="row">
          <label style={{ flex: 1 }}>
            Button (Arabic)
            <input name="cta_ar" defaultValue={p?.card.ctaAr} dir="rtl" maxLength={24} />
          </label>
          <label style={{ flex: 1 }}>
            Button (English), e.g. “Connect”
            <input name="cta_en" defaultValue={p?.card.ctaEn} maxLength={24} />
          </label>
        </div>
        <p className="muted" style={{ margin: 0 }}>The level on the portrait is each viewer&apos;s own affinity: it goes up by one for every 5 messages they send this hero.</p>
      </fieldset>
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
