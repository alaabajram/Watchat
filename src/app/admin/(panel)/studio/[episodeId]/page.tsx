// Studio review of one episode: the brief, the script (picture, speaker, Arabic, English, sound, where it goes),
// every planned sound with a player (and "Redo this audio" at the final check), the problems the checks find,
// a phone preview with sound, the note thread with Claude, and the moves for this stage.

import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash } from "@/components/admin/Flash";
import { StudioPreview } from "@/components/story/StudioPreview";
import { requireAdmin } from "@/lib/admin/auth";
import { STAGE_INFO, STAGES, isStage, sanitizeNotes, teamMoves } from "@/lib/studio/stages";
import { sanitizeBible, voicedCharacters } from "@/lib/studio/bible";
import { audioPlan, mediaMissing } from "@/lib/story/engine";
import { sanitizeCharacters, sanitizeStory } from "@/lib/story/sanitize";
import { STORY_STYLES, type Route, type Scene, type StoryStyle } from "@/lib/story/types";
import { validateStory } from "@/lib/story/validate";
import { db } from "@/lib/supabase";
import { addNoteAction, moveStageAction, publishFromStudioAction, redoAudioAction, updateBriefAction } from "../../../studio-actions";

export const dynamic = "force-dynamic";

function routeText(r: Route, num: (id: string | null) => string): string {
  if (r.type === "next") return num(r.to);
  if (r.type === "choices") return r.options.map((c) => `“${c.label.en || c.label.ar}”${c.price ? ` (${c.price} Ping)` : ""} ${num(c.to)}${c.sets ? ` · remembers ${c.sets}` : ""}`).join("\n");
  if (r.type === "branch") return `if ${r.flag}: ${num(r.ifSet)}\nelse: ${num(r.ifNot)}`;
  return r.ending ? `■ ending: ${r.ending.en || r.ending.ar}` : "■ end";
}

export default async function StudioEpisodePage({ params, searchParams }: { params: Promise<{ episodeId: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const admin = await requireAdmin("content");
  const { episodeId } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(episodeId)) notFound();
  const { data: item } = await db().from("studio_items").select("stage, brief, notes, credits_used, series_id").eq("episode_id", episodeId).eq("tenant_id", admin.tenantId).maybeSingle();
  if (!item || !isStage(item.stage)) notFound();
  const [{ data: ep }, { data: s }, { data: log }] = await Promise.all([
    db().from("episodes").select("id, number, title_ar, title_en, story_draft, story, story_version").eq("id", episodeId).maybeSingle(),
    db().from("series").select("id, code, title_en, story_style, story_characters, story_bible").eq("id", item.series_id).maybeSingle(),
    db().from("studio_credit_log").select("model, kind, credits, note, created_at").eq("episode_id", episodeId).order("created_at", { ascending: false }).limit(50),
  ]);
  if (!ep || !s) notFound();
  const stage = item.stage;
  const story = sanitizeStory(ep.story_draft ?? {});
  const characters = sanitizeCharacters(s.story_characters);
  const style = (STORY_STYLES.find((x) => x.key === s.story_style)?.key ?? "visual_novel") as StoryStyle;
  const issues = story.scenes.length ? validateStory(story, { characters, voices: voicedCharacters(sanitizeBible(s.story_bible)) }) : [];
  const sounds = audioPlan(story);
  const soundsMissing = mediaMissing(story).audio;
  const canRedoSound = stage === "final_check" || stage === "approved";
  const notes = sanitizeNotes(item.notes);
  const num = (id: string | null) => (id ? `→ ${story.scenes.findIndex((x) => x.id === id) + 1}` : "■ end");
  const who = (sc: Scene) => (sc.speaker ? (characters.find((c) => c.id === sc.speaker)?.name.en ?? sc.speaker) : "Narrator");
  const missing = story.scenes.filter((x) => !x.image && !x.video).length;
  const stepIndex = STAGES.indexOf(stage);

  return (
    <>
      <p>
        <Link href="/admin/studio">← Studio</Link>
      </p>
      <h1 style={{ marginBottom: 4 }}>
        {s.code} · Episode {ep.number}: {ep.title_en}
      </h1>
      <p className="muted" style={{ marginTop: 0 }} dir="rtl">
        {ep.title_ar}
      </p>
      <Flash ok={sp.ok} err={sp.err} />

      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", margin: "8px 0 14px" }}>
        {STAGES.map((st, i) => (
          <span key={st} className="badge" style={{ background: i === stepIndex ? "#1e1b26" : i < stepIndex ? "#e7f7ee" : "#f1eee9", color: i === stepIndex ? "#fff" : i < stepIndex ? "#15803d" : "#7b7388" }}>
            {i < stepIndex ? "✓ " : ""}
            {STAGE_INFO[st].label}
          </span>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 300px", gap: 16, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
          <div className="card" style={{ margin: 0 }}>
            <h2 style={{ marginTop: 0 }}>
              Now: {STAGE_INFO[stage].label} <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}>· {STAGE_INFO[stage].hint}</span>
            </h2>
            {stage === "approved" && (
              <form action={publishFromStudioAction} style={{ marginBottom: 10 }}>
                <input type="hidden" name="episode_id" value={ep.id} />
                <button type="submit">Publish episode {ep.number}</button>
              </form>
            )}
            <div style={{ display: "grid", gap: 8 }}>
              {teamMoves(stage).map((m) => (
                <form key={m.to} action={moveStageAction} className="row" style={{ gap: 8, alignItems: "flex-start" }}>
                  <input type="hidden" name="episode_id" value={ep.id} />
                  <input type="hidden" name="to" value={m.to} />
                  {m.needsNote && <textarea name="note" rows={2} placeholder="What should Claude change?" style={{ flex: 1 }} required />}
                  <button type="submit" className={m.kind === "approve" ? undefined : "secondary"} disabled={m.kind === "approve" && issues.some((i) => i.level === "error")}>
                    {m.label}
                  </button>
                </form>
              ))}
            </div>
            {STAGE_INFO[stage].who === "claude" && (
              <p className="muted" style={{ marginBottom: 0 }}>
                ✨ In Claude (Watchat + OpenArt connectors on), say: <em>&quot;Continue episode {ep.number} of {s.code}&quot;</em>.
              </p>
            )}
            <p className="muted" style={{ marginBottom: 0, fontSize: 13 }}>
              <Link href={`/admin/series/${s.id}/story?ep=${ep.id}`}>Edit scenes yourself in the Story builder →</Link>
              {ep.story ? ` · live version ${ep.story_version}` : ""} · {item.credits_used} OpenArt credits used
            </p>
          </div>

          {issues.length > 0 && (
            <div className="card" style={{ margin: 0 }}>
              <h2 style={{ marginTop: 0 }}>Checks</h2>
              <ul className="story-issues">
                {issues.map((i, k) => (
                  <li key={k} className={i.level}>
                    {i.level === "error" ? "✗ " : "⚠ "}
                    {i.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="card" style={{ margin: 0 }}>
            <h2 style={{ marginTop: 0 }}>
              Script{" "}
              <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}>
                · {story.scenes.length} scenes{story.scenes.length ? ` · pictures ${story.scenes.length - missing}/${story.scenes.length}` : ""}
                {sounds.length ? ` · sounds ${sounds.length - soundsMissing.length}/${sounds.length}` : ""}
              </span>
            </h2>
            {story.scenes.length === 0 ? (
              <p className="muted">Claude hasn&apos;t written it yet.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Picture</th>
                      <th>Who</th>
                      <th>Arabic</th>
                      <th>English</th>
                      <th>Sound</th>
                      <th>Then</th>
                    </tr>
                  </thead>
                  <tbody>
                    {story.scenes.map((sc, i) => (
                      <tr key={sc.id}>
                        <td>
                          {sc.id === story.start ? "▶ " : ""}
                          {i + 1}
                        </td>
                        <td style={{ minWidth: 70 }}>
                          {sc.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={sc.image.url} alt="" style={{ width: 48, height: 80, objectFit: "cover", borderRadius: 6 }} />
                          ) : sc.video ? (
                            <video src={sc.video.url} muted style={{ width: 48, height: 80, objectFit: "cover", borderRadius: 6 }} />
                          ) : (
                            <span className="muted" style={{ fontSize: 12 }}>{sc.ref ?? "—"}</span>
                          )}
                        </td>
                        <td style={{ fontSize: 13, color: characters.find((c) => c.id === sc.speaker)?.color }}>{who(sc)}</td>
                        <td dir="rtl" style={{ minWidth: 200 }}>{sc.text.ar}</td>
                        <td style={{ minWidth: 200 }}>{sc.text.en}</td>
                        <td style={{ fontSize: 12, minWidth: 110 }}>
                          {sc.musicRef && <div title="Music starts">♪ {sc.musicRef}</div>}
                          {sc.stopMusic && <div>♪ stop</div>}
                          {(sc.sfx ?? []).map((x) => (
                            <div key={x.id} title={x.desc}>
                              ✦ {x.id}
                              {!x.media && <span className="muted"> (to make)</span>}
                            </div>
                          ))}
                          {sc.voiceRef && (
                            <div>
                              🗣 {sc.voiceRef}
                              {!sc.audio && <span className="muted"> (to make)</span>}
                            </div>
                          )}
                        </td>
                        <td style={{ fontSize: 12, whiteSpace: "pre-line", minWidth: 140 }}>{routeText(sc.route, num)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {sounds.length > 0 && (
            <div className="card" style={{ margin: 0 }}>
              <h2 style={{ marginTop: 0 }}>
                Sound <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}>· ♪ music · ✦ effect · 🗣 voice{soundsMissing.length ? ` · ${soundsMissing.length} not made yet` : ""}</span>
              </h2>
              <div style={{ display: "grid", gap: 8 }}>
                {sounds.map((a) => (
                  <div key={a.ref} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 260px", gap: 10, alignItems: "center", borderTop: "1px solid #eee", paddingTop: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <strong>
                        {a.kind === "music" ? "♪" : a.kind === "sfx" ? "✦" : "🗣"} {a.ref}
                      </strong>{" "}
                      <span className="muted" style={{ fontSize: 12 }}>
                        {a.scenes.length ? `scene ${a.scenes.map((id) => story.scenes.findIndex((x) => x.id === id) + 1).join(", ")}` : "not used by any scene"}
                      </span>
                      {a.desc && <div style={{ fontSize: 13 }}>{a.desc}</div>}
                    </div>
                    {a.media ? (
                      // eslint-disable-next-line jsx-a11y/media-has-caption
                      <audio src={a.media.url} controls preload="none" style={{ width: "100%" }} />
                    ) : (
                      <span className="muted" style={{ fontSize: 13 }}>Not made yet</span>
                    )}
                    {a.media && canRedoSound && (
                      <form action={redoAudioAction} className="row" style={{ gap: 6, gridColumn: "1 / -1" }}>
                        <input type="hidden" name="episode_id" value={ep.id} />
                        <input type="hidden" name="ref" value={a.ref} />
                        <input name="note" placeholder={`What should change in ${a.ref}?`} style={{ flex: 1 }} />
                        <button type="submit" className="secondary">
                          Redo this audio
                        </button>
                      </form>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card" style={{ margin: 0 }}>
            <h2 style={{ marginTop: 0 }}>Brief</h2>
            <form action={updateBriefAction} style={{ display: "grid", gap: 8 }}>
              <input type="hidden" name="episode_id" value={ep.id} />
              <textarea name="brief" rows={4} defaultValue={item.brief ?? ""} />
              <button type="submit" className="secondary" style={{ justifySelf: "start" }}>
                Save brief
              </button>
            </form>
          </div>

          <div className="card" style={{ margin: 0 }}>
            <h2 style={{ marginTop: 0 }}>Notes with Claude</h2>
            {notes.length === 0 && <p className="muted">No notes yet.</p>}
            <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
              {notes.map((n, i) => (
                <div key={i} style={{ padding: "8px 12px", borderRadius: 12, background: n.who === "claude" ? "#f1eef9" : "#fff7e8" }}>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {n.who === "claude" ? "✨ Claude" : `👤 ${n.by}`} · {STAGE_INFO[n.stage].label} · {new Date(n.at).toLocaleString()}
                    {n.open ? " · open" : ""}
                  </div>
                  <div style={{ whiteSpace: "pre-wrap" }}>{n.text}</div>
                </div>
              ))}
            </div>
            <form action={addNoteAction} className="row" style={{ gap: 8 }}>
              <input type="hidden" name="episode_id" value={ep.id} />
              <input name="note" placeholder="Add a note for Claude" style={{ flex: 1 }} />
              <button type="submit" className="secondary">
                Add note
              </button>
            </form>
          </div>

          {(log ?? []).length > 0 && (
            <div className="card" style={{ margin: 0 }}>
              <h2 style={{ marginTop: 0 }}>OpenArt credits</h2>
              <table>
                <tbody>
                  {(log ?? []).map((l, i) => (
                    <tr key={i}>
                      <td className="muted" style={{ fontSize: 12 }}>{new Date(l.created_at).toLocaleString()}</td>
                      <td>
                        {l.model} · {l.kind}
                      </td>
                      <td>{l.credits}</td>
                      <td className="muted" style={{ fontSize: 12 }}>{l.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ position: "sticky", top: 12 }}>
          <StudioPreview story={story} style={style} characters={characters} />
        </div>
      </div>
    </>
  );
}
