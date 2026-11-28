// Admin → Rooms: every room is configuration — a format (mechanic), texts, colours, costs and a schedule of
// daily rounds. Add a new room here without code; the AI can draft rounds that the team approves.

import Link from "next/link";
import { Flash } from "@/components/admin/Flash";
import { requireAdmin } from "@/lib/admin/auth";
import { playDay } from "@/lib/daily/daily";
import { ensureStarter, toRoom } from "@/lib/play/store";
import { currentRound, daysPlanned, MECHANIC_KEYS, MECHANICS } from "@/lib/rooms/engine";
import { db } from "@/lib/supabase";
import { addStarterRoomsAction, createRoomAction } from "../../play-actions";

export const dynamic = "force-dynamic";

export default async function AdminRooms({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const admin = await requireAdmin("play");
  const sp = await searchParams;
  await ensureStarter(admin.tenantId);
  const day = playDay();
  const [{ data: rooms }, { data: rounds }] = await Promise.all([
    db().from("rooms").select("*").eq("tenant_id", admin.tenantId).order("sort"),
    db().from("room_rounds").select("id, room_id, day, status, prompt_en").eq("tenant_id", admin.tenantId).gte("day", `${day.slice(0, 4)}-01-01`),
  ]);
  const list = (rooms ?? []).map(toRoom);
  const ids = (rounds ?? []).filter((r) => r.day === day || r.status === "approved").map((r) => r.id as string);
  const { data: answers } = ids.length ? await db().from("room_answers").select("round_id").in("round_id", ids).limit(100000) : { data: [] };
  const plays = new Map<string, number>();
  for (const a of answers ?? []) plays.set(a.round_id as string, (plays.get(a.round_id as string) ?? 0) + 1);

  return (
    <>
      <h1>Rooms</h1>
      <Flash ok={sp.ok} err={sp.err} />
      <p className="muted">
        A room runs one round a day (Gulf time). When a day has no round, yesterday&apos;s stays up, so keep a few days planned. Formats are the
        only fixed part: {MECHANIC_KEYS.map((k) => MECHANICS[k].label).join(" · ")}. Add a room for any idea that fits a format.
      </p>
      <table>
        <thead>
          <tr>
            <th>Room</th>
            <th>Format</th>
            <th>Status</th>
            <th>Today</th>
            <th>Days planned</th>
            <th>Drafts</th>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => {
            const mine = (rounds ?? []).filter((x) => x.room_id === r.id) as { id: string; day: string; status: string; prompt_en: string }[];
            const cur = currentRound(mine, day);
            const planned = daysPlanned(mine, day);
            const drafts = mine.filter((x) => x.status === "draft").length;
            return (
              <tr key={r.id}>
                <td>
                  <Link href={`/admin/rooms/${r.id}`}>
                    {r.emoji} <strong>{r.titleEn}</strong>
                  </Link>
                  <div className="muted" dir="rtl">{r.titleAr}</div>
                </td>
                <td>{MECHANICS[r.mechanic].label}</td>
                <td>{r.status}</td>
                <td>
                  {cur ? (
                    <>
                      {cur.prompt_en}
                      <div className="muted">
                        {cur.day === day ? "today" : `since ${cur.day}`} · {plays.get(cur.id) ?? 0} answers
                      </div>
                    </>
                  ) : (
                    <span className="muted">No approved round</span>
                  )}
                </td>
                <td style={{ color: r.status === "live" && planned < 3 ? "var(--danger, #c0392b)" : undefined }}>{planned}</td>
                <td>{drafts || ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <form action={addStarterRoomsAction} style={{ marginTop: 12 }}>
        <button type="submit" className="secondary">Add the six starter rooms (skips any you already have)</button>
      </form>

      <h2>New room</h2>
      <form action={createRoomAction} className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="row">
          <label>
            Format
            <select name="mechanic" defaultValue="poll">
              {MECHANIC_KEYS.map((k) => (
                <option key={k} value={k}>
                  {MECHANICS[k].label} — {MECHANICS[k].hint}
                </option>
              ))}
            </select>
          </label>
          <label>
            Address
            <input name="slug" placeholder="e.g. food-fights" pattern="[a-z0-9-]{2,40}" required dir="ltr" />
          </label>
          <label>
            Emoji
            <input name="emoji" defaultValue="💬" style={{ width: 70 }} />
          </label>
          <label>
            Colour
            <input name="color" type="color" defaultValue="#ff5a48" />
          </label>
        </div>
        <div className="row">
          <label>
            Name (Arabic)
            <input name="title_ar" required dir="rtl" />
          </label>
          <label>
            Name (English)
            <input name="title_en" required />
          </label>
        </div>
        <div className="row">
          <label style={{ flex: 1 }}>
            One line (Arabic)
            <input name="blurb_ar" dir="rtl" />
          </label>
          <label style={{ flex: 1 }}>
            One line (English)
            <input name="blurb_en" />
          </label>
        </div>
        <label>
          Brief for the AI when it drafts rounds (optional)
          <textarea name="ai_brief" rows={2} placeholder="e.g. Food debates from across the Arab world; playful, never insulting." />
        </label>
        <div>
          <button type="submit">Create room</button>
        </div>
      </form>
    </>
  );
}
