// Admin → Rooms → one room: its settings, the AI drafter and the schedule of rounds (edit, approve, remove).

import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash } from "@/components/admin/Flash";
import { ImageField } from "@/components/admin/ImageField";
import { requireAdmin } from "@/lib/admin/auth";
import { addDays, playDay } from "@/lib/daily/daily";
import { toRoom, toRound, type RoundRow } from "@/lib/play/store";
import { MECHANICS, roundIssues, tally, type Mechanic } from "@/lib/rooms/engine";
import { DEFAULT_CTA } from "@/lib/rooms/display";
import { db } from "@/lib/supabase";
import { approveRoundsAction, deleteRoundAction, draftRoundsAction, saveRoomAction, saveRoundAction } from "../../../play-actions";

export const dynamic = "force-dynamic";

function RoundForm({ roomId, mechanic, round, day }: { roomId: string; mechanic: Mechanic; round?: RoundRow; day: string }) {
  const spec = MECHANICS[mechanic];
  const slots = mechanic === "opinion" ? 0 : spec.maxOptions;
  const correctIdx = round ? round.options.findIndex((o) => o.correct) : -1;
  return (
    <form action={saveRoundAction} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <input type="hidden" name="room_id" value={roomId} />
      {round ? <input type="hidden" name="round_id" value={round.id} /> : null}
      <label>
        Day
        <input name="day" type="date" defaultValue={round?.day ?? day} required />
      </label>
      <div className="row">
        <label style={{ flex: 1 }}>
          Question (Arabic)
          <input name="prompt_ar" defaultValue={round?.promptAr} dir="rtl" />
        </label>
        <label style={{ flex: 1 }}>
          Question (English)
          <input name="prompt_en" defaultValue={round?.promptEn} />
        </label>
      </div>
      {spec.clues ? (
        <div className="row">
          <label style={{ flex: 1 }}>
            Clues (Arabic, one per line)
            <textarea name="clues_ar" rows={3} defaultValue={round?.extra.cluesAr?.join("\n")} dir="rtl" />
          </label>
          <label style={{ flex: 1 }}>
            Clues (English, one per line)
            <textarea name="clues_en" rows={3} defaultValue={round?.extra.cluesEn?.join("\n")} />
          </label>
        </div>
      ) : null}
      {Array.from({ length: slots }, (_, i) => {
        const o = round?.options[i];
        return (
          <fieldset key={i} style={{ border: "1px solid #e5e5ea", borderRadius: 10, padding: 10 }}>
            <legend className="muted">
              {mechanic === "hot_seat" ? "Question" : mechanic === "debate" ? "Side" : "Answer"} {i + 1}
              {i >= spec.minOptions ? " (optional)" : ""}
            </legend>
            <div className="row">
              <input name={`opt_ar_${i}`} defaultValue={o?.ar} dir="rtl" placeholder="Arabic" style={{ flex: 1 }} />
              <input name={`opt_en_${i}`} defaultValue={o?.en} placeholder="English" style={{ flex: 1 }} />
              {spec.oneCorrect ? (
                <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <input type="radio" name="correct" value={String(i)} defaultChecked={correctIdx === i} />
                  {mechanic === "liar" ? "the lie" : "right"}
                </label>
              ) : null}
            </div>
            {spec.reveals ? (
              <div className="row" style={{ marginTop: 6 }}>
                <textarea name={`rev_ar_${i}`} rows={2} defaultValue={o?.revealAr} dir="rtl" placeholder={mechanic === "hot_seat" ? "Guest's answer (Arabic)" : "Argument (Arabic)"} style={{ flex: 1 }} />
                <textarea name={`rev_en_${i}`} rows={2} defaultValue={o?.revealEn} placeholder={mechanic === "hot_seat" ? "Guest's answer (English)" : "Argument (English)"} style={{ flex: 1 }} />
              </div>
            ) : null}
          </fieldset>
        );
      })}
      {mechanic === "opinion" ? <p className="muted">Viewers answer on the fixed five-point scale (strongly disagree → strongly agree).</p> : null}
      {spec.oneCorrect ? (
        <div className="row">
          <label style={{ flex: 1 }}>
            Why (Arabic, shown after answering)
            <input name="explain_ar" defaultValue={round?.extra.explainAr} dir="rtl" />
          </label>
          <label style={{ flex: 1 }}>
            Why (English)
            <input name="explain_en" defaultValue={round?.extra.explainEn} />
          </label>
        </div>
      ) : null}
      <div className="row">
        <button type="submit" name="intent" value="approve">Save &amp; approve</button>
        <button type="submit" name="intent" value="draft" className="secondary">Save as draft</button>
      </div>
    </form>
  );
}

export default async function AdminRoom({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const admin = await requireAdmin("play");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const sp = await searchParams;
  const { data } = await db().from("rooms").select("*").eq("id", id).eq("tenant_id", admin.tenantId).maybeSingle();
  if (!data) notFound();
  const room = toRoom(data);
  const spec = MECHANICS[room.mechanic];
  const today = playDay();
  const { data: rows } = await db().from("room_rounds").select("*").eq("room_id", id).gte("day", addDays(today, -14)).order("day");
  const rounds = (rows ?? []).map((r) => toRound(room.mechanic, r));
  const ids = rounds.map((r) => r.id);
  const { data: answers } = ids.length ? await db().from("room_answers").select("round_id, option_id").in("round_id", ids).limit(100000) : { data: [] };
  const counts = new Map<string, Record<string, number>>();
  for (const a of answers ?? []) {
    const c = counts.get(a.round_id as string) ?? {};
    c[a.option_id as string] = (c[a.option_id as string] ?? 0) + 1;
    counts.set(a.round_id as string, c);
  }
  const lastDay = rounds.map((r) => r.day).sort().pop();
  const nextDay = lastDay && lastDay >= today ? addDays(lastDay, 1) : today;
  const drafts = rounds.filter((r) => r.status === "draft").length;

  return (
    <>
      <p>
        <Link href="/admin/rooms">← Rooms</Link>
      </p>
      <h1>
        {room.emoji} {room.titleEn} <span className="muted" style={{ fontSize: 16 }}>· {spec.label} · /rooms/{room.slug}</span>
      </h1>
      <Flash ok={sp.ok} err={sp.err} />

      <details className="card" open={room.status !== "live"}>
        <summary style={{ cursor: "pointer" }}>
          <strong>Room settings</strong> · {room.status}
        </summary>
        <form action={saveRoomAction} style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
          <input type="hidden" name="id" value={room.id} />
          <div className="row">
            <label>
              Status
              <select name="status" defaultValue={room.status}>
                <option value="draft">Draft (hidden)</option>
                <option value="live">Live</option>
                <option value="archived">Archived</option>
              </select>
            </label>
            <label>
              Emoji
              <input name="emoji" defaultValue={room.emoji} style={{ width: 70 }} />
            </label>
            <label>
              Colour
              <input name="color" type="color" defaultValue={room.color} />
            </label>
            <label>
              Order
              <input name="sort" type="number" defaultValue={room.sort} style={{ width: 80 }} />
            </label>
          </div>
          <div className="row" style={{ alignItems: "flex-start", gap: 20 }}>
            <ImageField name="image_path" label="Picture" hint="Home tile, hero and room page. 4:3 or wider works best." path={room.imagePath} url={room.image} ratio="4 / 3" />
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <label>
                On the Home page
                <select name="home_slot" defaultValue={room.homeSlot}>
                  <option value="hero">Hero (the big card at the top — one room)</option>
                  <option value="tile">Tile (two per row)</option>
                  <option value="wide">Wide card (full width)</option>
                  <option value="hidden">Not on Home</option>
                </select>
              </label>
              <label>
                Label (Arabic), e.g. «تحدي سريع»
                <input name="tag_ar" defaultValue={room.tagAr} dir="rtl" maxLength={40} />
              </label>
              <label>
                Label (English), e.g. “Casual PvP”
                <input name="tag_en" defaultValue={room.tagEn} maxLength={40} />
              </label>
              <label>
                Group (Arabic) — filter tab on the Rooms page
                <input name="group_ar" defaultValue={room.groupAr} dir="rtl" maxLength={30} />
              </label>
              <label>
                Group (English), e.g. “PvP &amp; debate”
                <input name="group_en" defaultValue={room.groupEn} maxLength={30} />
              </label>
              <label>
                Button (Arabic) — empty uses «{DEFAULT_CTA[room.mechanic].ar}»
                <input name="cta_ar" defaultValue={room.ctaAr} dir="rtl" maxLength={24} />
              </label>
              <label>
                Button (English) — empty uses “{DEFAULT_CTA[room.mechanic].en}”
                <input name="cta_en" defaultValue={room.ctaEn} maxLength={24} />
              </label>
            </div>
          </div>
          <div className="row">
            <label style={{ flex: 1 }}>
              Name (Arabic)
              <input name="title_ar" defaultValue={room.titleAr} dir="rtl" />
            </label>
            <label style={{ flex: 1 }}>
              Name (English)
              <input name="title_en" defaultValue={room.titleEn} />
            </label>
          </div>
          <div className="row">
            <label style={{ flex: 1 }}>
              One line (Arabic)
              <input name="blurb_ar" defaultValue={room.blurbAr} dir="rtl" />
            </label>
            <label style={{ flex: 1 }}>
              One line (English)
              <input name="blurb_en" defaultValue={room.blurbEn} />
            </label>
          </div>
          <div className="row">
            <label>
              Results
              <select name="results" defaultValue={room.config.results}>
                <option value="after_answer">Right after answering</option>
                <option value="next_day">Next day</option>
              </select>
            </label>
            {spec.oneCorrect ? (
              <label>
                Free Ping for a right answer
                <input name="reward_ping" type="number" min={0} max={1000} defaultValue={room.config.rewardPing} style={{ width: 90 }} />
              </label>
            ) : (
              <input type="hidden" name="reward_ping" value="0" />
            )}
            {room.mechanic === "hot_seat" ? (
              <>
                <label>
                  Guest (Arabic)
                  <input name="guest_ar" defaultValue={room.config.guestAr} dir="rtl" />
                </label>
                <label>
                  Guest (English)
                  <input name="guest_en" defaultValue={room.config.guestEn} />
                </label>
              </>
            ) : null}
          </div>
          <label>
            Brief for the AI
            <textarea name="ai_brief" rows={2} defaultValue={room.config.aiBrief} />
          </label>
          <div>
            <button type="submit">Save room</button>
          </div>
        </form>
      </details>

      <h2>Rounds</h2>
      <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
        <form action={draftRoundsAction} className="row">
          <input type="hidden" name="room_id" value={room.id} />
          <select name="count" defaultValue="7">
            <option value="3">3 days</option>
            <option value="7">7 days</option>
            <option value="14">14 days</option>
          </select>
          <button type="submit">✨ Draft rounds with AI</button>
        </form>
        {drafts ? (
          <form action={approveRoundsAction}>
            <input type="hidden" name="room_id" value={room.id} />
            <button type="submit" className="secondary">Approve all {drafts} drafts that pass the checks</button>
          </form>
        ) : null}
      </div>
      <p className="muted">Drafts are never shown to viewers. The AI writes after the last planned day and avoids repeating earlier questions.</p>

      {rounds.map((r) => {
        const issues = roundIssues(room.mechanic, r);
        const t = tally(r.options, counts.get(r.id) ?? {});
        return (
          <details key={r.id} className="card">
            <summary style={{ cursor: "pointer" }}>
              <strong>{r.day}</strong>
              {r.day === today ? " (today)" : ""} · {r.promptEn || r.promptAr} · {r.status}
              {r.source === "ai" ? " · AI" : ""} · {t.total} answers
              {issues.length ? <span style={{ color: "#c0392b" }}> · needs fixing</span> : null}
            </summary>
            {t.total ? (
              <p className="muted" style={{ margin: "8px 0" }}>
                {r.options.map((o) => `${o.en}: ${t.rows.find((x) => x.id === o.id)?.pct ?? 0}%`).join(" · ")}
              </p>
            ) : null}
            {issues.length ? <p style={{ color: "#c0392b" }}>{issues.join(" ")}</p> : null}
            <RoundForm roomId={room.id} mechanic={room.mechanic} round={r} day={r.day} />
            {t.total === 0 ? (
              <form action={deleteRoundAction} style={{ marginTop: 8 }}>
                <input type="hidden" name="room_id" value={room.id} />
                <input type="hidden" name="round_id" value={r.id} />
                <button type="submit" className="secondary">Remove this round</button>
              </form>
            ) : null}
          </details>
        );
      })}

      <h3>New round</h3>
      <div className="card">
        <RoundForm roomId={room.id} mechanic={room.mechanic} day={nextDay} />
      </div>
    </>
  );
}
