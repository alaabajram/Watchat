// Studio → series bible: the style line every picture prompt uses, the dialect, house rules, the theme tune and
// each character's locked look, reference portrait, locked voice and voice sample. Claude writes the first version; the team edits and locks it.

import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash } from "@/components/admin/Flash";
import { requireAdmin } from "@/lib/admin/auth";
import { sanitizeBible, setupStatus, SETUP_LABEL } from "@/lib/studio/bible";
import { sanitizeCharacters } from "@/lib/story/sanitize";
import { db } from "@/lib/supabase";
import { saveBibleAction, sendOutlineAction } from "../../../../studio-actions";

export const dynamic = "force-dynamic";

export default async function BiblePage({ params, searchParams }: { params: Promise<{ seriesId: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const admin = await requireAdmin("content");
  const { seriesId } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(seriesId)) notFound();
  const { data: s } = await db().from("series").select("id, code, title_en, story_bible, story_characters").eq("id", seriesId).eq("tenant_id", admin.tenantId).maybeSingle();
  if (!s) notFound();
  const bible = sanitizeBible(s.story_bible);
  const chars = sanitizeCharacters(s.story_characters);
  const status = setupStatus(bible);
  const { data: eps } = await db().from("episodes").select("id, number").eq("series_id", s.id);
  const { data: inStudio } = await db().from("studio_items").select("episode_id").eq("series_id", s.id);
  const studioIds = new Set((inStudio ?? []).map((i) => i.episode_id));
  const sentNumbers = new Set((eps ?? []).filter((e) => studioIds.has(e.id)).map((e) => e.number));
  // The next three episodes not yet sent start ticked.
  const nextUp = bible.outline.filter((o) => !sentNumbers.has(o.number)).slice(0, 3).map((o) => o.number);
  return (
    <>
      <p>
        <Link href="/admin/studio">← Studio</Link>
      </p>
      <h1>
        {s.code} · {s.title_en}: bible &amp; outline {bible.locked ? "🔒" : ""}
      </h1>
      <p style={{ marginTop: 0 }}>
        <span className="badge">{SETUP_LABEL[status]}</span>
        {status === "needs_claude" && (
          <span className="muted">
            {" "}
            In Claude (Watchat Studio on), say: <em>&quot;Set up {s.code}&quot;</em>.
          </span>
        )}
      </p>
      <p className="muted" style={{ marginTop: 0 }}>
        Claude reads this before every episode. Ask Claude to &quot;set up the bible and character portraits for {s.code}&quot;, check the portraits here, then lock it so
        faces stay the same in every episode.
      </p>
      <Flash ok={sp.ok} err={sp.err} />
      <form action={saveBibleAction} className="card" style={{ display: "grid", gap: 12 }}>
        <input type="hidden" name="series_id" value={s.id} />
        <div className="grid2" style={{ gridTemplateColumns: "1fr 160px" }}>
          <label>
            Your brief for the series (Claude reads it first)
            <textarea name="brief" rows={4} defaultValue={bible.brief} />
          </label>
          <label>
            Episodes planned
            <input name="planned" type="number" min={0} max={200} defaultValue={bible.planned} />
          </label>
        </div>
        <label>
          Style line (pasted into every picture prompt)
          <textarea name="style" rows={3} defaultValue={bible.style} placeholder="Cinematic photorealistic still, real actors, 50mm lens, natural skin texture, vertical 9:16, no text, calm lower third." />
        </label>
        <label>
          Dialect
          <input name="dialect" defaultValue={bible.dialect} placeholder="Light Gulf (Emirati)" />
        </label>
        <label>
          House rules (one per line)
          <textarea name="rules" rows={5} defaultValue={bible.rules.join("\n")} placeholder={"No swearing\nNasser is funny, never mean\nNo faces in the bottom third"} />
        </label>
        <h2 style={{ margin: "6px 0 0" }}>Theme music</h2>
        <label>
          The series theme (every episode&apos;s music is built on it)
          <textarea name="theme_desc" rows={2} defaultValue={bible.theme.desc} placeholder="Warm oud and soft strings, slow then lifting, hopeful; 70 bpm" />
        </label>
        {bible.theme.url ? (
          <div style={{ display: "grid", gap: 4 }}>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <audio src={bible.theme.url} controls preload="none" style={{ width: "100%", maxWidth: 420 }} />
            <label className="inline" style={{ fontWeight: 400, fontSize: 13 }}>
              <input type="checkbox" name="clear_theme" /> Remove this tune (Claude makes a new one; unlock first)
            </label>
          </div>
        ) : (
          <span className="muted" style={{ fontSize: 13 }}>No tune yet: Claude makes it during setup.</span>
        )}
        <h2 style={{ margin: "6px 0 0" }}>Characters</h2>
        {bible.characters.length === 0 && <p className="muted">Claude adds the characters and their portraits with the bible.</p>}
        {bible.characters.map((c) => {
          const ch = chars.find((x) => x.id === c.id);
          return (
            <div key={c.id} style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: 12, alignItems: "start" }}>
              {c.portrait ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.portrait} alt="" style={{ width: 90, height: 150, objectFit: "cover", borderRadius: 10 }} />
              ) : (
                <div style={{ width: 90, height: 150, borderRadius: 10, background: "#f1eee9", display: "grid", placeItems: "center", fontSize: 12 }} className="muted">
                  no portrait
                </div>
              )}
              <div style={{ display: "grid", gap: 6 }}>
                <strong style={{ color: ch?.color }}>
                  {ch?.name.en ?? c.id} {ch?.name.ar ? `· ${ch.name.ar}` : ""}
                </strong>
                <textarea name={`look_${c.id}`} rows={3} defaultValue={c.look} placeholder="Locked look: age, face, hair, skin, outfit" />
                {c.portrait && (
                  <label className="inline" style={{ fontWeight: 400, fontSize: 13 }}>
                    <input type="checkbox" name={`clear_${c.id}`} /> Remove this portrait (Claude makes a new one; unlock first)
                  </label>
                )}
                <textarea name={`voice_${c.id}`} rows={2} defaultValue={c.voice} placeholder="Locked voice: age, tone, accent, pace (empty = never speaks aloud)" />
                {c.voiceSample ? (
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                    <audio src={c.voiceSample} controls preload="none" style={{ width: 280 }} />
                    <label className="inline" style={{ fontWeight: 400, fontSize: 13 }}>
                      <input type="checkbox" name={`clear_voice_${c.id}`} /> Remove this voice sample
                    </label>
                  </div>
                ) : (
                  <span className="muted" style={{ fontSize: 12 }}>{c.voice ? "Voice sample missing: Claude makes it during setup. No voice lines until it's there." : "No voice: this character has no voice lines."}</span>
                )}
              </div>
            </div>
          );
        })}
        <h2 style={{ margin: "6px 0 0" }}>Episode outline</h2>
        {bible.outline.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Claude writes one short brief per planned episode during setup. You can edit them here before sending.</p>
        ) : (
          bible.outline.map((o) => (
            <label key={o.number}>
              {o.number}. {o.title.en} {o.title.ar ? `· ${o.title.ar}` : ""} {sentNumbers.has(o.number) ? "✓ sent to Claude" : ""}
              <textarea name={`outline_${o.number}`} rows={2} defaultValue={o.brief} />
            </label>
          ))
        )}
        <label className="inline" style={{ fontWeight: 600 }}>
          <input type="checkbox" name="locked" defaultChecked={bible.locked} /> Lock the bible (Claude can&apos;t change characters, voices, theme, style, rules or outline; no new portraits or voice samples)
        </label>
        <button type="submit" style={{ justifySelf: "start" }}>
          Save bible
        </button>
      </form>

      {bible.outline.length > 0 && (
        <form action={sendOutlineAction} className="card" style={{ display: "grid", gap: 8 }}>
          <input type="hidden" name="series_id" value={s.id} />
          <h2 style={{ margin: 0 }}>Send episodes to Claude</h2>
          {!bible.locked && <p className="muted" style={{ margin: 0 }}>Lock the bible first (above), so every episode keeps the same faces, style and rules.</p>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 6 }}>
            {bible.outline.map((o) => (
              <label key={o.number} className="inline" style={{ fontWeight: 400 }}>
                <input type="checkbox" name="numbers" value={o.number} disabled={sentNumbers.has(o.number) || !bible.locked} defaultChecked={nextUp.includes(o.number)} />
                {o.number}. {o.title.en || o.title.ar} {sentNumbers.has(o.number) ? "✓" : ""}
              </label>
            ))}
          </div>
          <span className="muted" style={{ fontSize: 13 }}>Ticked episodes appear on the Studio board as &quot;Brief&quot;. Claude writes one per chat; nothing costs OpenArt credits until you approve a script.</span>
          <button type="submit" style={{ justifySelf: "start" }} disabled={!bible.locked}>
            Send ticked episodes to Claude
          </button>
        </form>
      )}
    </>
  );
}
