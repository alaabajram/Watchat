"use client";

// Story builder: pick an episode, build its scenes (media, text, choices, routing), see the routes on a map,
// play it in the phone preview, then Publish. Drafts save by themselves; viewers only see published versions.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  addStoryEpisode,
  fetchStoryMedia,
  importStoryScript,
  publishStory,
  renameStoryEpisode,
  saveCharacters,
  saveStoryDraft,
  setStoryFormat,
  unpublishStory,
} from "@/app/admin/story-actions";
import { flagsSetIn, targetsOf } from "@/lib/story/engine";
import { applyPicture, pictureRefs, refFromFileName } from "@/lib/story/import";
import { STORY_STYLES, blankScene, nextId, type Character, type Scene, type StoryGraph, type StoryStyle } from "@/lib/story/types";
import { hasErrors, validateStory, type StoryIssue } from "@/lib/story/validate";
import { SceneEditor } from "./SceneEditor";
import { StoryMap } from "./StoryMap";
import { StoryPlayer } from "./StoryPlayer";
import { uploadStoryFile } from "./upload";

export type BuilderEpisode = {
  id: string;
  number: number;
  titleAr: string;
  titleEn: string;
  status: string;
  version: number;
  draft: StoryGraph;
  live: StoryGraph | null;
};

type Props = {
  seriesId: string;
  seriesStatus: string;
  format: "video" | "story";
  style: StoryStyle;
  characters: Character[];
  episodes: BuilderEpisode[];
  startEpisode: string | null;
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function StoryBuilder(p: Props) {
  const router = useRouter();
  const [style, setStyle] = useState<StoryStyle>(p.style);
  const [episodes, setEpisodes] = useState(p.episodes);
  const [epId, setEpId] = useState<string | null>(p.startEpisode ?? p.episodes[0]?.id ?? null);
  const [selected, setSelected] = useState<string | null>(null);
  const [characters, setCharacters] = useState(p.characters);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [previewFrom, setPreviewFrom] = useState<string | null>(null);
  const [previewLang, setPreviewLang] = useState<"ar" | "en">("ar");
  const [previewKey, setPreviewKey] = useState(0);
  const [view, setView] = useState<"list" | "map">("list");

  const ep = episodes.find((e) => e.id === epId) ?? null;
  const story = ep?.draft ?? null;
  const flagsKnown = useMemo(() => flagsSetIn(episodes.flatMap((e) => [e.draft, e.live].filter((g): g is StoryGraph => Boolean(g)))), [episodes]);
  const issues: StoryIssue[] = useMemo(() => (story ? validateStory(story, { flagsKnown, characters }) : []), [story, flagsKnown, characters]);
  const issueIds = useMemo(() => new Set(issues.filter((i) => i.level === "error" && i.sceneId).map((i) => i.sceneId!)), [issues]);

  // ---- editing the draft (autosaved) ----
  const timer = useRef<number | null>(null);
  const pending = useRef<{ id: string; graph: StoryGraph } | null>(null);
  const flush = useCallback(async () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    const job = pending.current;
    pending.current = null;
    if (!job) return;
    try {
      const r = await saveStoryDraft(job.id, job.graph);
      setSaved(new Date(r.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : "Couldn't save." });
    }
  }, []);
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (pending.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);

  const update = useCallback(
    (graph: StoryGraph) => {
      if (!ep) return;
      setEpisodes((list) => list.map((e) => (e.id === ep.id ? { ...e, draft: graph } : e)));
      pending.current = { id: ep.id, graph };
      setSaved(null);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), 1200);
    },
    [ep, flush],
  );

  const switchEpisode = async (id: string) => {
    await flush();
    setEpId(id);
    setSelected(null);
    setPreviewFrom(null);
    setNote(null);
    window.history.replaceState(null, "", `?ep=${id}`);
  };

  const setScene = (s: Scene) => story && update({ ...story, scenes: story.scenes.map((x) => (x.id === s.id ? s : x)) });

  const addScene = (after?: Scene) => {
    if (!story) return;
    const id = nextId("s", story.scenes.map((s) => s.id));
    const fresh = { ...blankScene(id), speaker: after?.speaker ?? null };
    let scenes = [...story.scenes];
    if (after) {
      const i = scenes.findIndex((s) => s.id === after.id);
      // "New scene after this": this scene now continues to the new one, which continues where it used to go.
      const oldTo = after.route.type === "next" ? after.route.to : null;
      fresh.route = { type: "next", to: oldTo };
      scenes = scenes.map((s) => (s.id === after.id ? { ...s, route: { type: "next", to: id } } : s));
      scenes.splice(i + 1, 0, fresh);
    } else {
      // Added at the end: the last scene that ended continues to it.
      const last = [...scenes].reverse().find((s) => s.route.type === "next" && s.route.to === null);
      if (last) scenes = scenes.map((s) => (s.id === last.id ? { ...s, route: { type: "next", to: id } } : s));
      scenes.push(fresh);
    }
    update({ ...story, start: story.start ?? id, scenes });
    setSelected(id);
  };

  const removeScene = (id: string) => {
    if (!story || !window.confirm("Delete this scene? Routes that led to it will end the episode instead.")) return;
    const unlink = (to: string | null) => (to === id ? null : to);
    const scenes = story.scenes
      .filter((s) => s.id !== id)
      .map((s) => {
        const r = s.route;
        if (r.type === "next") return { ...s, route: { ...r, to: unlink(r.to) } };
        if (r.type === "choices") return { ...s, route: { ...r, options: r.options.map((c) => ({ ...c, to: unlink(c.to) })) } };
        if (r.type === "branch") return { ...s, route: { ...r, ifSet: unlink(r.ifSet), ifNot: unlink(r.ifNot) } };
        return s;
      });
    update({ ...story, start: story.start === id ? (scenes[0]?.id ?? null) : story.start, scenes });
    setSelected(null);
  };

  const duplicate = (s: Scene) => {
    if (!story) return;
    const id = nextId("s", story.scenes.map((x) => x.id));
    const i = story.scenes.findIndex((x) => x.id === s.id);
    const scenes = [...story.scenes];
    scenes.splice(i + 1, 0, { ...structuredClone(s), id, name: s.name ? `${s.name} (copy)` : "" });
    update({ ...story, scenes });
    setSelected(id);
  };

  const move = (s: Scene, dir: -1 | 1) => {
    if (!story) return;
    const i = story.scenes.findIndex((x) => x.id === s.id);
    const j = i + dir;
    if (j < 0 || j >= story.scenes.length) return;
    const scenes = [...story.scenes];
    [scenes[i], scenes[j]] = [scenes[j], scenes[i]];
    update({ ...story, scenes });
  };

  // Drop many pictures at once: one scene each, in file-name order, joined one after the other.
  const bulkPictures = async (files: FileList | null) => {
    if (!story || !files?.length) return;
    const list = [...files].filter((f) => /^image\//.test(f.type)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    let graph = story;
    for (let k = 0; k < list.length; k++) {
      setBusy(`Uploading ${k + 1}/${list.length}…`);
      try {
        const image = await uploadStoryFile(p.seriesId, list[k], "image");
        const id = nextId("s", graph.scenes.map((s) => s.id));
        const last = [...graph.scenes].reverse().find((s) => s.route.type === "next" && s.route.to === null);
        const scenes = graph.scenes.map((s) => (last && s.id === last.id ? { ...s, route: { type: "next" as const, to: id } } : s));
        graph = { ...graph, start: graph.start ?? id, scenes: [...scenes, { ...blankScene(id, list[k].name.replace(/\.[^.]+$/, "").slice(0, 40)), image, motion: style === "motion_comic" ? "zoom_in" : "none", auto: style === "motion_comic" ? 5 : 0 }] };
        update(graph);
      } catch (e) {
        setNote({ ok: false, text: e instanceof Error ? e.message : "Upload failed" });
        break;
      }
    }
    setBusy(null);
  };

  // Pictures named after the script's picture names (img_01.jpg …): each is uploaded once and put on every
  // scene, in every episode, that uses that name. Changed episodes are saved as drafts.
  const matchPictures = async (files: FileList | null) => {
    if (!files?.length) return;
    await flush();
    const wanted = new Set(pictureRefs(episodes.map((e) => e.draft)).map((r) => r.ref));
    const list = [...files].filter((f) => wanted.has(refFromFileName(f.name)));
    const skipped = files.length - list.length;
    let next = episodes;
    const changed = new Set<string>();
    let placed = 0;
    for (let k = 0; k < list.length; k++) {
      setBusy(`Uploading ${k + 1}/${list.length}…`);
      try {
        const image = await uploadStoryFile(p.seriesId, list[k], "image");
        const ref = refFromFileName(list[k].name);
        next = next.map((e) => {
          const r = applyPicture(e.draft, ref, image);
          if (!r.count) return e;
          changed.add(e.id);
          placed += r.count;
          return { ...e, draft: r.story };
        });
        setEpisodes(next);
      } catch (e) {
        setNote({ ok: false, text: e instanceof Error ? e.message : "Upload failed" });
        break;
      }
    }
    setBusy("Saving…");
    for (const e of next) if (changed.has(e.id)) await saveStoryDraft(e.id, e.draft);
    setBusy(null);
    setNote({ ok: true, text: `${list.length} picture(s) placed on ${placed} scene(s).${skipped ? ` ${skipped} file(s) skipped: their names don't match any picture name.` : ""}` });
  };

  const publish = async () => {
    if (!ep || !story) return;
    await flush();
    setBusy("Publishing…");
    setNote(null);
    try {
      const r = await publishStory(ep.id, story);
      if (!r.ok) setNote({ ok: false, text: `Not published: fix the ${r.issues.filter((i) => i.level === "error").length} problem(s) listed above.` });
      else {
        setEpisodes((list) => list.map((e) => (e.id === ep.id ? { ...e, live: story, version: r.version ?? e.version + 1, status: r.live ? "live" : e.status === "draft" ? "in_review" : e.status } : e)));
        setNote({ ok: true, text: r.live ? `Episode ${ep.number} is live (version ${r.version}).` : `Episode ${ep.number} published (version ${r.version}); viewers see it once the series is live.` });
      }
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : "Couldn't publish." });
    } finally {
      setBusy(null);
    }
  };

  const unpublish = async () => {
    if (!ep || !window.confirm(`Hide episode ${ep.number} from viewers? Its scenes stay here as a draft.`)) return;
    await unpublishStory(ep.id);
    setEpisodes((list) => list.map((e) => (e.id === ep.id ? { ...e, live: null, status: "draft" } : e)));
    setNote({ ok: true, text: `Episode ${ep.number} is hidden again.` });
  };

  const addEpisode = async () => {
    await flush();
    const e = await addStoryEpisode(p.seriesId);
    const fresh: BuilderEpisode = { id: e.id, number: e.number, titleAr: `الحلقة ${e.number}`, titleEn: `Episode ${e.number}`, status: "draft", version: 0, draft: { v: 1, start: null, scenes: [] }, live: null };
    setEpisodes((l) => [...l, fresh]);
    setEpId(e.id);
    setSelected(null);
  };

  // ---- not a story series yet ----
  if (p.format !== "story") {
    return (
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Turn this into a story series?</h2>
        <p className="muted">
          Story series are built from scenes (pictures, short clips, voice, music and text) with choices that change what happens. They play on the web; the chat
          sends the link. This series uses video episodes now; switching keeps its details, artwork, price and licence, and its videos stay saved.
        </p>
        <StylePicker value={style} onChange={setStyle} />
        <button
          type="button"
          style={{ marginTop: 12 }}
          onClick={async () => {
            await setStoryFormat(p.seriesId, "story", style);
            router.refresh();
          }}
        >
          Make it a story series
        </button>
      </div>
    );
  }

  const changed = ep && !same(ep.draft, ep.live);
  const errors = issues.filter((i) => i.level === "error");

  return (
    <>
      <details className="card" open={characters.length === 0}>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>
          Look & characters · {STORY_STYLES.find((s) => s.key === style)?.label} · {characters.length} character{characters.length === 1 ? "" : "s"}
        </summary>
        <div style={{ display: "grid", gap: 14, marginTop: 12 }}>
          <StylePicker
            value={style}
            onChange={async (v) => {
              setStyle(v);
              await setStoryFormat(p.seriesId, "story", v);
            }}
          />
          <CharactersEditor seriesId={p.seriesId} value={characters} chat={style === "chat"} onSaved={setCharacters} />
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Back to video episodes?{" "}
            <button
              type="button"
              className="secondary small"
              onClick={async () => {
                if (!window.confirm("Switch back to video episodes? The scenes stay saved but viewers will get the video player.")) return;
                await setStoryFormat(p.seriesId, "video", style);
                router.refresh();
              }}
            >
              Use video episodes
            </button>
          </p>
        </div>
      </details>

      <datalist id="story-flags">
        {flagsKnown.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>

      <ImportPanel
        seriesId={p.seriesId}
        refs={pictureRefs(episodes.map((e) => e.draft))}
        busy={busy}
        onPictures={(f) => void matchPictures(f)}
        onImported={async () => {
          await flush();
          window.location.reload();
        }}
      />

      <div className="story-builder">
        {/* Episodes */}
        <div className="story-eps">
          {episodes.map((e) => {
            const dirty = !same(e.draft, e.live);
            return (
              <button key={e.id} type="button" className="story-ep" aria-current={e.id === epId} onClick={() => void switchEpisode(e.id)}>
                <span>
                  {e.number}. {e.titleEn || e.titleAr}
                </span>
                <small>
                  {e.live ? (e.status === "live" ? "● Live" : "Published") : "Draft"}
                  {e.live && dirty ? " · edits not published" : ""} · {e.draft.scenes.length} scenes
                </small>
              </button>
            );
          })}
          <button type="button" className="secondary small" onClick={() => void addEpisode()}>
            + Add episode
          </button>
        </div>

        {/* Scenes */}
        <div style={{ minWidth: 0, display: "grid", gap: 12 }}>
          {!ep || !story ? (
            <div className="card">Add an episode to start.</div>
          ) : (
            <>
              <div className="card" style={{ marginBottom: 0, display: "grid", gap: 10 }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div className="row" style={{ gap: 8, flex: 1 }}>
                    <strong>Episode {ep.number}</strong>
                    <input
                      dir="rtl"
                      defaultValue={ep.titleAr}
                      key={`ar-${ep.id}`}
                      placeholder="العنوان"
                      onBlur={(e) => {
                        const v = e.target.value;
                        setEpisodes((l) => l.map((x) => (x.id === ep.id ? { ...x, titleAr: v } : x)));
                        void renameStoryEpisode(ep.id, v, ep.titleEn);
                      }}
                      style={{ width: 170 }}
                    />
                    <input
                      defaultValue={ep.titleEn}
                      key={`en-${ep.id}`}
                      placeholder="Title"
                      onBlur={(e) => {
                        const v = e.target.value;
                        setEpisodes((l) => l.map((x) => (x.id === ep.id ? { ...x, titleEn: v } : x)));
                        void renameStoryEpisode(ep.id, ep.titleAr, v);
                      }}
                      style={{ width: 170 }}
                    />
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <span className="muted" style={{ fontSize: 13 }}>{busy ?? (pending.current ? "Saving…" : saved ? `Draft saved ${saved}` : "")}</span>
                    {ep.live && (
                      <button type="button" className="secondary small" onClick={() => void unpublish()}>
                        Hide
                      </button>
                    )}
                    <button type="button" onClick={() => void publish()} disabled={Boolean(busy) || errors.length > 0 || (!changed && Boolean(ep.live))} title={errors.length ? "Fix the problems first" : undefined}>
                      {ep.live ? (changed ? "Publish changes" : `Published v${ep.version}`) : "Publish episode"}
                    </button>
                  </div>
                </div>
                {note && <div className={`flash ${note.ok ? "flash-ok" : "flash-err"}`} style={{ margin: 0 }}>{note.text}</div>}
                {issues.length > 0 && (
                  <ul className="story-issues">
                    {issues.slice(0, 12).map((i, k) => (
                      <li key={k} className={i.level} onClick={() => i.sceneId && setSelected(i.sceneId)}>
                        {i.level === "error" ? "✗ " : "⚠ "}
                        {i.message}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="row" style={{ gap: 6 }}>
                  <button type="button" className="small" onClick={() => addScene()}>
                    + Add scene
                  </button>
                  <label className="abtn secondary small" style={{ cursor: "pointer", display: "inline-block", fontWeight: 600 }}>
                    ⬆ Many pictures → one scene each
                    <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => void bulkPictures(e.target.files)} />
                  </label>
                  <span style={{ flex: 1 }} />
                  <button type="button" className={view === "list" ? "small" : "secondary small"} onClick={() => setView("list")}>
                    Scenes
                  </button>
                  <button type="button" className={view === "map" ? "small" : "secondary small"} onClick={() => setView("map")}>
                    Routes map
                  </button>
                </div>
              </div>

              {view === "map" && (
                <div className="card" style={{ marginBottom: 0 }}>
                  <StoryMap
                    story={story}
                    selected={selected}
                    issueIds={issueIds}
                    onSelect={(id) => {
                      setSelected(id);
                      setView("list");
                    }}
                  />
                  <p className="muted" style={{ margin: "8px 0 0", fontSize: 12 }}>
                    Grey: continue · blue: a choice · coral: premium choice · green / brown dashed: depends on an earlier choice. Click a scene to edit it.
                  </p>
                </div>
              )}

              {view === "list" && (
                <div className="story-scenes">
                  {story.scenes.length === 0 && (
                    <div className="card" style={{ marginBottom: 0 }}>
                      <p style={{ marginTop: 0 }}>No scenes yet. Add a scene, or drop many pictures at once (named 01.jpg, 02.jpg, …) to get one scene each, joined in order.</p>
                    </div>
                  )}
                  {story.scenes.map((s, i) => (
                    <div key={s.id} className={`story-scene-card${issueIds.has(s.id) ? " has-error" : ""}`} aria-current={s.id === selected}>
                      <button type="button" className="story-scene-head" onClick={() => setSelected(s.id === selected ? null : s.id)}>
                        {s.image?.url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={s.image.url} alt="" />
                        ) : (
                          <span className="story-thumb">{s.video ? "🎬" : s.audio ? "🔊" : "💬"}</span>
                        )}
                        <span className="story-snippet">
                          <strong>
                            {s.id === story.start ? "▶ " : ""}
                            {i + 1}. {s.name || "Scene"}
                            {s.speaker && <span style={{ display: "inline", marginInlineStart: 6, color: characters.find((c) => c.id === s.speaker)?.color }}>· {characters.find((c) => c.id === s.speaker)?.name.en || characters.find((c) => c.id === s.speaker)?.name.ar}</span>}
                          </strong>
                          <span dir="auto">{s.text.ar || s.text.en || "—"}</span>
                        </span>
                        <RouteChips scene={s} scenes={story.scenes} />
                      </button>
                      {s.id === selected && (
                        <SceneEditor
                          seriesId={p.seriesId}
                          scene={s}
                          index={i}
                          scenes={story.scenes}
                          characters={characters}
                          flags={flagsKnown}
                          isStart={s.id === story.start}
                          onChange={setScene}
                          onAddAfter={() => addScene(s)}
                          onDuplicate={() => duplicate(s)}
                          onDelete={() => removeScene(s.id)}
                          onMove={(d) => move(s, d)}
                          onMakeStart={() => update({ ...story, start: s.id })}
                          onPreviewFrom={() => {
                            setPreviewFrom(s.id);
                            setPreviewKey((k) => k + 1);
                          }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Phone preview */}
        <div className="story-phone-col">
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className={previewLang === "ar" ? "small" : "secondary small"} onClick={() => setPreviewLang("ar")}>
              عربي
            </button>
            <button type="button" className={previewLang === "en" ? "small" : "secondary small"} onClick={() => setPreviewLang("en")}>
              English
            </button>
            <button
              type="button"
              className="secondary small"
              onClick={() => {
                setPreviewFrom(null);
                setPreviewKey((k) => k + 1);
              }}
            >
              ↺ From the start
            </button>
          </div>
          <div className="story-phone wc">
            {story && story.scenes.length > 0 ? (
              <StoryPlayer key={`${ep?.id}-${previewKey}-${previewLang}`} story={story} style={style} characters={characters} locale={previewLang} preview jumpTo={previewFrom} />
            ) : (
              <div className="wc-story-empty" style={{ fontSize: 14, padding: 20, textAlign: "center" }}>
                The preview plays here.
              </div>
            )}
          </div>
          <span className="muted" style={{ fontSize: 12, textAlign: "center", maxWidth: 280 }}>
            Preview of the draft: tap to go on. Premium choices are free here; nothing is saved.
            {hasErrors(issues) ? " Fix the red problems before publishing." : ""}
          </span>
        </div>
      </div>
    </>
  );
}

function RouteChips({ scene, scenes }: { scene: Scene; scenes: Scene[] }) {
  const num = (id: string | null) => (id ? `→ ${scenes.findIndex((s) => s.id === id) + 1}` : "■ end");
  const r = scene.route;
  return (
    <span className="story-route-chips">
      {r.type === "next" && <span>{num(r.to)}</span>}
      {r.type === "choices" &&
        r.options.map((c) => (
          <span key={c.id} className={c.price > 0 ? "premium" : undefined}>
            {(c.label.en || c.label.ar || "…").slice(0, 14)} {num(c.to)}
            {c.price > 0 ? ` · ${c.price} Ping` : ""}
          </span>
        ))}
      {r.type === "branch" && (
        <>
          <span>if {r.flag || "…"} {num(r.ifSet)}</span>
          <span>else {num(r.ifNot)}</span>
        </>
      )}
      {r.type === "end" && <span>■ {r.ending ? r.ending.en || r.ending.ar : "end"}</span>}
      {targetsOf(scene).length === 0 && r.type !== "end" && <span>■ end</span>}
    </span>
  );
}

function StylePicker({ value, onChange }: { value: StoryStyle; onChange: (v: StoryStyle) => void }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8 }}>
      {STORY_STYLES.map((s) => (
        <label key={s.key} className="inline" style={{ alignItems: "flex-start", padding: 10, border: `1px solid ${value === s.key ? "#1e1b26" : "#e2ddd6"}`, borderRadius: 12, background: "#fff", cursor: "pointer" }}>
          <input type="radio" name="story-style" checked={value === s.key} onChange={() => onChange(s.key)} style={{ marginTop: 3 }} />
          <span>
            <strong>{s.label}</strong>
            <span className="muted" style={{ display: "block", fontWeight: 400, fontSize: 12 }}>
              {s.hint}
            </span>
          </span>
        </label>
      ))}
    </div>
  );
}

function CharactersEditor(p: { seriesId: string; value: Character[]; chat: boolean; onSaved: (c: Character[]) => void }) {
  const [list, setList] = useState(p.value);
  const [state, setState] = useState<string | null>(null);
  const setOne = (i: number, patch: Partial<Character>) => setList((l) => l.map((c, j) => (j === i ? { ...c, ...patch } : patch.owner ? { ...c, owner: false } : c)));
  const palette = ["#ff5a48", "#3b82f6", "#16a34a", "#a855f7", "#f59e0b", "#0ea5e9", "#ec4899"];
  return (
    <div className="story-chars">
      <strong>Characters</strong>
      <span className="muted" style={{ fontSize: 13 }}>
        Who speaks in the scenes: their name shows above the text in their colour.{p.chat ? " In a chat story, tick whose phone it is: their messages appear on the other side." : ""}
      </span>
      {list.map((c, i) => (
        <div key={c.id} className="story-char-row">
          <label className="story-avatar" style={{ background: c.color }} title="Picture (optional)">
            {c.avatar?.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.avatar.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              (c.name.en || c.name.ar).slice(0, 1) || "?"
            )}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setState("Uploading…");
                try {
                  setOne(i, { avatar: await uploadStoryFile(p.seriesId, f, "image") });
                  setState(null);
                } catch (err) {
                  setState(err instanceof Error ? err.message : "Upload failed");
                }
              }}
            />
          </label>
          <input dir="rtl" value={c.name.ar} onChange={(e) => setOne(i, { name: { ...c.name, ar: e.target.value.slice(0, 40) } })} placeholder="الاسم" />
          <input value={c.name.en} onChange={(e) => setOne(i, { name: { ...c.name, en: e.target.value.slice(0, 40) } })} placeholder="Name" />
          <input type="color" value={c.color} onChange={(e) => setOne(i, { color: e.target.value })} />
          {p.chat ? (
            <label className="inline" style={{ fontWeight: 400, fontSize: 13 }}>
              <input type="checkbox" checked={Boolean(c.owner)} onChange={(e) => setOne(i, { owner: e.target.checked })} /> Phone owner
            </label>
          ) : (
            <span />
          )}
          <button type="button" className="secondary small danger" onClick={() => setList((l) => l.filter((_, j) => j !== i))} aria-label="Remove">
            ✕
          </button>
        </div>
      ))}
      <div className="row" style={{ gap: 6 }}>
        <button type="button" className="secondary small" onClick={() => setList((l) => [...l, { id: nextId("p", l.map((c) => c.id)), name: { ar: "", en: "" }, color: palette[l.length % palette.length], avatar: null }])}>
          + Add character
        </button>
        <button
          type="button"
          className="small"
          onClick={async () => {
            setState("Saving…");
            try {
              const saved = await saveCharacters(p.seriesId, list);
              setList(saved);
              p.onSaved(saved);
              setState("Saved ✓");
            } catch (e) {
              setState(e instanceof Error ? e.message : "Couldn't save");
            }
          }}
        >
          Save characters
        </button>
        {state && <span className="muted" style={{ fontSize: 13 }}>{state}</span>}
      </div>
    </div>
  );
}

/** Import a story script (JSON from the story prompt) and match pictures by their names. */
function ImportPanel(p: { seriesId: string; refs: { ref: string; scenes: number; missing: number }[]; busy: string | null; onPictures: (f: FileList | null) => void; onImported: () => void }) {
  const [text, setText] = useState("");
  const [state, setState] = useState<{ ok: boolean; text: string; notes?: string[] } | null>(null);
  const [working, setWorking] = useState(false);
  const missing = p.refs.filter((r) => r.missing > 0);
  return (
    <details className="card" open={p.refs.length > 0 && missing.length > 0}>
      <summary style={{ cursor: "pointer", fontWeight: 700 }}>
        Import a story script & pictures
        {p.refs.length > 0 && (
          <span className="muted" style={{ fontWeight: 500 }}>
            {" "}
            · pictures {p.refs.length - missing.length}/{p.refs.length} placed
          </span>
        )}
      </summary>
      <div className="grid2" style={{ marginTop: 12, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 8 }}>
          <strong>1. Paste the script</strong>
          <span className="muted" style={{ fontSize: 13 }}>
            Paste the whole reply from ChatGPT or Claude (or just its JSON block). Characters are added, and each episode&apos;s scenes, choices and routes become
            its draft. If the script has a &quot;media&quot; list (picture name → OpenArt file address), the pictures and clips are fetched and placed too.
            Episodes that already have scenes get the imported ones instead (their live version stays until you publish).
          </span>
          <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder='{ "characters": [...], "episodes": [...] }' style={{ fontFamily: "monospace", fontSize: 12 }} />
          <div className="row" style={{ gap: 8 }}>
            <button
              type="button"
              className="small"
              disabled={!text.trim() || working}
              onClick={async () => {
                setWorking(true);
                setState(null);
                try {
                  const r = await importStoryScript(p.seriesId, text);
                  const summary = `Imported ${r.episodes.map((e) => `episode ${e.number} (${e.scenes} scenes${e.created ? ", new" : ""})`).join(", ")}.`;
                  const notes = [...r.notes];
                  // Files listed in the script (e.g. OpenArt results): fetched one by one onto the scenes.
                  let placed = 0;
                  for (let k = 0; k < r.media.length; k++) {
                    const m = r.media[k];
                    setState({ ok: true, text: `${summary} Fetching pictures and clips ${k + 1}/${r.media.length}…`, notes });
                    try {
                      placed += (await fetchStoryMedia(p.seriesId, m.ref, m.url)).scenes;
                    } catch (e) {
                      notes.push(e instanceof Error ? e.message : `${m.ref}: couldn't fetch it.`);
                    }
                  }
                  setState({ ok: true, text: `${summary}${r.media.length ? ` ${placed} scene(s) got their picture or clip.` : ""} Reloading…`, notes });
                  window.setTimeout(p.onImported, notes.length ? 4000 : 800);
                } catch (e) {
                  setState({ ok: false, text: e instanceof Error ? e.message : "Import failed" });
                } finally {
                  setWorking(false);
                }
              }}
            >
              {working ? "Importing…" : "Import"}
            </button>
            {state && <span style={{ fontSize: 13, color: state.ok ? "#15803d" : "#b91c1c" }}>{state.text}</span>}
          </div>
          {state?.notes && state.notes.length > 0 && (
            <ul className="story-issues">
              {state.notes.map((n, i) => (
                <li key={i}>⚠ {n}</li>
              ))}
            </ul>
          )}
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          <strong>2. Add the pictures</strong>
          {p.refs.length === 0 ? (
            <span className="muted" style={{ fontSize: 13 }}>After an import, the picture names (img_01, img_02, …) are listed here.</span>
          ) : (
            <>
              <span className="muted" style={{ fontSize: 13 }}>
                Name each file after its picture (img_01.jpg, img_02.png, …) and drop them all at once: each goes on every scene that uses it, in every episode.
              </span>
              <label className="story-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); p.onPictures(e.dataTransfer.files); }}>
                {p.busy ?? "⬆ Drop or choose the pictures"}
                <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden disabled={Boolean(p.busy)} onChange={(e) => p.onPictures(e.target.files)} />
              </label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {p.refs.map((r) => (
                  <span key={r.ref} className="badge" style={{ background: r.missing ? "#fff4dc" : "#e7f7ee", color: r.missing ? "#8a5a0b" : "#15803d" }} title={`${r.scenes} scene(s)`}>
                    {r.missing ? "○" : "✓"} {r.ref} · {r.scenes}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </details>
  );
}
