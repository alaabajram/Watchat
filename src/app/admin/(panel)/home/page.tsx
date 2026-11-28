// Admin → Home page: every text and picture on the viewer Home (and the Heroes page header) (headline, section titles, the Today pictures,
// Discover tiles) and where each room shows (hero / tile / wide / hidden). Room and AI People pictures and
// labels are set on their own pages. Empty boxes fall back to the default text.

import Link from "next/link";
import { Flash } from "@/components/admin/Flash";
import { ImageField } from "@/components/admin/ImageField";
import { requireAdmin } from "@/lib/admin/auth";
import { DEFAULT_HOME, type HomeTile, type L } from "@/lib/play/home";
import { homeContent, playImage, toRoom } from "@/lib/play/store";
import { db } from "@/lib/supabase";
import { saveHomeAction, saveHomeSlotAction } from "../../play-actions";

export const dynamic = "force-dynamic";

function Pair({ name, label, value, n = 160, area = false }: { name: string; label: string; value: L; n?: number; area?: boolean }) {
  return (
    <div className="row">
      <label style={{ flex: 1 }}>
        {label} (Arabic)
        {area ? <textarea name={`${name}_ar`} defaultValue={value.ar} dir="rtl" maxLength={n} rows={2} /> : <input name={`${name}_ar`} defaultValue={value.ar} dir="rtl" maxLength={n} />}
      </label>
      <label style={{ flex: 1 }}>
        {label} (English)
        {area ? <textarea name={`${name}_en`} defaultValue={value.en} maxLength={n} rows={2} /> : <input name={`${name}_en`} defaultValue={value.en} maxLength={n} />}
      </label>
    </div>
  );
}

const EMPTY_TILE: HomeTile = { kicker: { ar: "", en: "" }, title: { ar: "", en: "" }, text: { ar: "", en: "" }, cta: { ar: "", en: "" }, href: "/", image: null, color: "#31e5a0" };

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const admin = await requireAdmin("play");
  const sp = await searchParams;
  const [c, { data: rows }] = await Promise.all([homeContent(admin.tenantId), db().from("rooms").select("*").eq("tenant_id", admin.tenantId).neq("status", "archived").order("sort")]);
  const rooms = (rows ?? []).map(toRoom);
  const tiles = [...c.discover.tiles, ...Array.from({ length: 6 - c.discover.tiles.length }, () => EMPTY_TILE)];

  return (
    <>
      <h1>Home page</h1>
      <Flash ok={sp.ok} err={sp.err} />
      <p className="muted">
        What signed-in viewers see first. Pictures and labels of rooms and AI People are on{" "}
        <Link href="/admin/rooms">Rooms</Link> and <Link href="/admin/people">AI People</Link>. Live numbers (playing today, votes, streak) are counted
        automatically.{" "}
        <a href="/" target="_blank" rel="noreferrer">
          Open the Home page ↗
        </a>
      </p>

      <h2>Rooms on Home</h2>
      <table>
        <thead>
          <tr>
            <th>Room</th>
            <th>Status</th>
            <th>Place on Home</th>
          </tr>
        </thead>
        <tbody>
          {rooms.map((r) => (
            <tr key={r.id}>
              <td>
                <Link href={`/admin/rooms/${r.id}`}>
                  {r.emoji} {r.titleEn}
                </Link>
                {r.image ? " · 🖼️" : <span className="muted"> · no picture</span>}
                {r.tagEn ? <span className="muted"> · {r.tagEn}</span> : null}
              </td>
              <td>{r.status}</td>
              <td>
                <form action={saveHomeSlotAction} className="row">
                  <input type="hidden" name="id" value={r.id} />
                  <select name="home_slot" defaultValue={r.homeSlot}>
                    <option value="hero">Hero (top)</option>
                    <option value="tile">Tile</option>
                    <option value="wide">Wide card</option>
                    <option value="hidden">Not on Home</option>
                  </select>
                  <button type="submit" className="secondary">Save</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">Only live rooms show. Without a hero, the first tile room becomes the hero.</p>

      <form action={saveHomeAction} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <h2>Top of the page</h2>
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Pair name="kicker" label="Small line above the headline" value={c.kicker} n={60} />
          <Pair name="headline" label="Headline" value={c.headline} n={80} />
          <Pair name="highlight" label="Headline, green part" value={c.highlight} n={80} />
          <p className="muted" style={{ margin: 0 }}>
            Default: “{DEFAULT_HOME.headline.en} <b>{DEFAULT_HOME.highlight.en}</b>”. The streak banner and the “playing today” count are automatic.
          </p>
        </div>

        <h2>Your day (card &amp; horoscope)</h2>
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Pair name="day_title" label="Title" value={c.day.title} n={60} />
          <Pair name="day_sub" label="Line under the title" value={c.day.sub} n={120} />
          <div className="row" style={{ gap: 24 }}>
            <ImageField name="card_image" label="Card of the day picture" hint="Shown on the card tile (tarot art works well)." path={c.day.cardImage} url={playImage(c.day.cardImage)} ratio="1 / 0.95" />
            <ImageField name="horoscope_image" label="Horoscope picture" hint="Shown on the horoscope tile." path={c.day.horoscopeImage} url={playImage(c.day.horoscopeImage)} ratio="1 / 0.95" />
          </div>
        </div>

        <h2>Rooms section</h2>
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Pair name="rooms_title" label="Title" value={c.rooms.title} n={60} />
          <Pair name="rooms_badge" label="Badge next to the title" value={c.rooms.badge} n={30} />
          <Pair name="rooms_sub" label="Line under the title" value={c.rooms.sub} n={120} />
        </div>

        <h2>AI People section</h2>
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Pair name="people_title" label="Title" value={c.people.title} n={60} />
          <Pair name="people_badge" label="Badge" value={c.people.badge} n={30} />
          <Pair name="people_sub" label="Line under the title" value={c.people.sub} n={120} />
        </div>

        <h2>Heroes page (top)</h2>
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Pair name="heroes_kicker" label="Small line" value={c.heroes.kicker} n={60} />
          <Pair name="heroes_title" label="Title" value={c.heroes.title} n={60} />
          <Pair name="heroes_badge" label="Badge" value={c.heroes.badge} n={20} />
          <Pair name="heroes_sub" label="Line under the title" value={c.heroes.sub} n={200} area />
          <p className="muted" style={{ margin: 0 }}>Each hero&apos;s card (portrait, voice note, group tab, stats, button) is set in <Link href="/admin/people">AI People</Link>.</p>
        </div>

        <h2>Discover tiles</h2>
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Pair name="discover_title" label="Section title" value={c.discover.title} n={60} />
          <p className="muted" style={{ margin: 0 }}>Up to six tiles. Leave a tile&apos;s title empty to remove it. Links: a page of ours (e.g. /explore, /rewards, /rooms/debate) or a full https address.</p>
        </div>
        {tiles.map((t, i) => (
          <details key={i} className="card" open={i < c.discover.tiles.length}>
            <summary style={{ cursor: "pointer" }}>
              <strong>Tile {i + 1}</strong> {t.title.en ? `· ${t.title.en}` : <span className="muted">· empty</span>}
            </summary>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
              <div className="row" style={{ alignItems: "flex-start", gap: 20 }}>
                <ImageField name={`t${i}_image`} label="Picture" path={t.image} url={playImage(t.image)} ratio="1 / 1" />
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <label>
                    Link
                    <input name={`t${i}_href`} defaultValue={t.title.en || t.title.ar ? t.href : ""} placeholder="/explore" dir="ltr" />
                  </label>
                  <label>
                    Colour
                    <input name={`t${i}_color`} type="color" defaultValue={t.color} />
                  </label>
                </div>
              </div>
              <Pair name={`t${i}_kicker`} label="Small label" value={t.kicker} n={60} />
              <Pair name={`t${i}_title`} label="Title" value={t.title} n={80} />
              <Pair name={`t${i}_text`} label="Text" value={t.text} n={200} area />
              <Pair name={`t${i}_cta`} label="Button" value={t.cta} n={30} />
            </div>
          </details>
        ))}
        <div>
          <button type="submit">Save Home page</button>
        </div>
      </form>
    </>
  );
}
