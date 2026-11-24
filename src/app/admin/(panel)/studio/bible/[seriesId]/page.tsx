// Studio → series bible: the style line every picture prompt uses, the dialect, house rules and each
// character's locked look and reference portrait. Claude writes the first version; the team edits and locks it.

import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash } from "@/components/admin/Flash";
import { requireAdmin } from "@/lib/admin/auth";
import { sanitizeBible } from "@/lib/studio/bible";
import { sanitizeCharacters } from "@/lib/story/sanitize";
import { db } from "@/lib/supabase";
import { saveBibleAction } from "../../../../studio-actions";

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
  return (
    <>
      <p>
        <Link href="/admin/studio">← Studio</Link>
      </p>
      <h1>
        {s.code} · series bible {bible.locked ? "🔒" : ""}
      </h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Claude reads this before every episode. Ask Claude to &quot;set up the bible and character portraits for {s.code}&quot;, check the portraits here, then lock it so
        faces stay the same in every episode.
      </p>
      <Flash ok={sp.ok} err={sp.err} />
      <form action={saveBibleAction} className="card" style={{ display: "grid", gap: 12 }}>
        <input type="hidden" name="series_id" value={s.id} />
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
              </div>
            </div>
          );
        })}
        <label className="inline" style={{ fontWeight: 600 }}>
          <input type="checkbox" name="locked" defaultChecked={bible.locked} /> Lock the bible (Claude can&apos;t change characters, style or rules; no new portraits)
        </label>
        <button type="submit" style={{ justifySelf: "start" }}>
          Save bible
        </button>
      </form>
    </>
  );
}
