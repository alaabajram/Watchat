"use client";

// One scene in the Story builder: its picture / clip / sound / music, who speaks, the text in Arabic and English,
// the camera move, and where it goes next (continue, choices with optional Ping price, depends on an earlier
// choice, or the end of the episode).

import { useState } from "react";
import { LIMITS, MOTIONS, STORY_ACCEPT, nextId, type Character, type Choice, type Route, type Scene, type StoryMedia, type StoryMediaType } from "@/lib/story/types";
import { uploadStoryFile } from "./upload";

type Props = {
  seriesId: string;
  scene: Scene;
  index: number;
  scenes: Scene[];
  characters: Character[];
  flags: string[];
  isStart: boolean;
  onChange: (s: Scene) => void;
  onAddAfter: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  onMakeStart: () => void;
  onPreviewFrom: () => void;
};

const sceneLabel = (s: Scene, i: number) => `${i + 1}. ${s.name || (s.text.ar || s.text.en).slice(0, 28) || "Scene"}`;

export function SceneEditor(p: Props) {
  const s = p.scene;
  const set = (patch: Partial<Scene>) => p.onChange({ ...s, ...patch });
  const setRoute = (route: Route) => set({ route });
  const others = p.scenes.map((x, i) => ({ id: x.id, label: sceneLabel(x, i) })).filter((x) => x.id !== s.id);

  const target = (value: string | null, onPick: (v: string | null) => void, endLabel = "End of the episode") => (
    <select value={value ?? ""} onChange={(e) => onPick(e.target.value || null)}>
      <option value="">■ {endLabel}</option>
      {others.map((o) => (
        <option key={o.id} value={o.id}>
          → {o.label}
        </option>
      ))}
    </select>
  );

  const changeType = (type: Route["type"]) => {
    if (type === s.route.type) return;
    if (type === "next") setRoute({ type: "next", to: null });
    if (type === "choices")
      setRoute({
        type: "choices",
        options: [
          { id: "c1", label: { ar: "", en: "" }, to: null, price: 0, sets: null },
          { id: "c2", label: { ar: "", en: "" }, to: null, price: 0, sets: null },
        ],
      });
    if (type === "branch") setRoute({ type: "branch", flag: p.flags[0] ?? "", ifSet: null, ifNot: null });
    if (type === "end") setRoute({ type: "end", ending: null });
  };

  const setChoice = (i: number, patch: Partial<Choice>) => {
    if (s.route.type !== "choices") return;
    setRoute({ ...s.route, options: s.route.options.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  };

  return (
    <div className="story-scene-editor">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
        <input value={s.name} onChange={(e) => set({ name: e.target.value.slice(0, LIMITS.name) })} placeholder={`Scene ${p.index + 1} name (only you see it)`} style={{ flex: "1 1 220px", fontWeight: 600 }} />
        <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
          {p.isStart ? <span className="badge live">▶ Start</span> : <button type="button" className="secondary small" onClick={p.onMakeStart}>Make start</button>}
          <button type="button" className="secondary small" onClick={p.onPreviewFrom} title="Play the preview from this scene">▶ Preview here</button>
          <button type="button" className="secondary small" onClick={() => p.onMove(-1)} title="Move up">↑</button>
          <button type="button" className="secondary small" onClick={() => p.onMove(1)} title="Move down">↓</button>
          <button type="button" className="secondary small" onClick={p.onDuplicate}>Duplicate</button>
          <button type="button" className="secondary small danger" onClick={p.onDelete}>Delete</button>
        </div>
      </div>

      <div className="story-media-grid">
        <MediaField seriesId={p.seriesId} label={s.ref ? `Picture · ${s.ref}` : "Picture"} type="image" value={s.image} onChange={(image) => set({ image })} hint={s.ref ? `Script picture name: ${s.ref}.jpg` : "Vertical 9:16 works best (1080×1920)."} />
        <MediaField seriesId={p.seriesId} label="Clip (instead of a picture)" type="video" value={s.video} onChange={(video) => set({ video })} hint="Short MP4, plays with sound." />
        <MediaField seriesId={p.seriesId} label="Voice / sound" type="audio" value={s.audio} onChange={(audio) => set({ audio })} hint="Plays once with this scene." />
        <div>
          <MediaField seriesId={p.seriesId} label="Music" type="audio" value={s.music} onChange={(music) => set({ music, stopMusic: music ? false : s.stopMusic })} hint="Loops and carries on into the next scenes." />
          <label className="inline" style={{ fontWeight: 400, fontSize: 13 }}>
            <input type="checkbox" checked={s.stopMusic} onChange={(e) => set({ stopMusic: e.target.checked, music: e.target.checked ? null : s.music })} /> Stop the music here
          </label>
        </div>
      </div>

      <div className="grid3" style={{ alignItems: "end" }}>
        <label>
          Who speaks
          <select value={s.speaker ?? ""} onChange={(e) => set({ speaker: e.target.value || null })}>
            <option value="">Narrator (no name)</option>
            {p.characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name.en || c.name.ar} {c.name.ar && c.name.en ? `· ${c.name.ar}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Camera move
          <select value={s.motion} onChange={(e) => set({ motion: e.target.value as Scene["motion"] })} disabled={!s.image}>
            {MOTIONS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Moves on by itself after
          <span className="row" style={{ gap: 6 }}>
            <input type="number" min={0} max={LIMITS.maxAuto} value={s.auto} onChange={(e) => set({ auto: Math.max(0, Math.min(LIMITS.maxAuto, Number(e.target.value) || 0)) })} style={{ width: 80 }} disabled={s.route.type === "choices"} />
            <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>sec (0 = on tap)</span>
          </span>
        </label>
      </div>

      <div className="grid2">
        <label>
          Text (Arabic)
          <textarea dir="rtl" rows={3} value={s.text.ar} maxLength={LIMITS.text} onChange={(e) => set({ text: { ...s.text, ar: e.target.value } })} placeholder="ما يقوله المتحدث أو الراوي" />
        </label>
        <label>
          Text (English)
          <textarea rows={3} value={s.text.en} maxLength={LIMITS.text} onChange={(e) => set({ text: { ...s.text, en: e.target.value } })} placeholder="What the speaker or narrator says" />
        </label>
      </div>

      <fieldset className="story-route">
        <legend>Then</legend>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          {(
            [
              ["next", "Continue"],
              ["choices", "Viewer chooses"],
              ["branch", "Depends on an earlier choice"],
              ["end", "Episode ends"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" className={s.route.type === k ? "small" : "secondary small"} onClick={() => changeType(k)}>
              {label}
            </button>
          ))}
        </div>

        {s.route.type === "next" && (
          <div className="row" style={{ marginTop: 8, gap: 8, flexWrap: "wrap" }}>
            {target(s.route.to, (to) => setRoute({ type: "next", to }))}
            <button type="button" className="secondary small" onClick={p.onAddAfter}>+ New scene after this</button>
          </div>
        )}

        {s.route.type === "choices" && (
          <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
            {s.route.options.map((c, i) => (
              <div key={c.id} className="story-choice-row">
                <input dir="rtl" value={c.label.ar} maxLength={LIMITS.label} onChange={(e) => setChoice(i, { label: { ...c.label, ar: e.target.value } })} placeholder={`الخيار ${i + 1}`} />
                <input value={c.label.en} maxLength={LIMITS.label} onChange={(e) => setChoice(i, { label: { ...c.label, en: e.target.value } })} placeholder={`Choice ${i + 1}`} />
                {target(c.to, (to) => setChoice(i, { to }))}
                <label className="inline" style={{ fontWeight: 400, fontSize: 13 }} title="0 = free. A price makes it a premium choice, paid once with Ping.">
                  Ping
                  <input type="number" min={0} max={LIMITS.maxPrice} value={c.price} onChange={(e) => setChoice(i, { price: Math.max(0, Math.min(LIMITS.maxPrice, Number(e.target.value) || 0)) })} style={{ width: 70 }} />
                </label>
                <input
                  list="story-flags"
                  value={c.sets ?? ""}
                  onChange={(e) => setChoice(i, { sets: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40) || null })}
                  placeholder="Remember as… (optional)"
                  title="Give this choice a short name (e.g. trusted_omar) so later scenes, in any episode, can depend on it."
                />
                <button type="button" className="secondary small danger" onClick={() => s.route.type === "choices" && setRoute({ ...s.route, options: s.route.options.filter((_, j) => j !== i) })} aria-label="Remove choice">
                  ✕
                </button>
              </div>
            ))}
            {s.route.options.length < LIMITS.choices && (
              <button
                type="button"
                className="secondary small"
                style={{ justifySelf: "start" }}
                onClick={() => s.route.type === "choices" && setRoute({ ...s.route, options: [...s.route.options, { id: nextId("c", s.route.options.map((c) => c.id)), label: { ar: "", en: "" }, to: null, price: 0, sets: null }] })}
              >
                + Add a choice
              </button>
            )}
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              Up to {LIMITS.choices} choices. A Ping price makes one premium (paid once, free on replays); always keep a free one.
            </p>
          </div>
        )}

        {s.route.type === "branch" && (
          <div className="grid3" style={{ marginTop: 8, alignItems: "end" }}>
            <label>
              If the viewer chose
              <input list="story-flags" value={s.route.flag} onChange={(e) => s.route.type === "branch" && setRoute({ ...s.route, flag: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40) })} placeholder="e.g. trusted_omar" />
            </label>
            <label>
              then go to
              {target(s.route.ifSet, (ifSet) => s.route.type === "branch" && setRoute({ ...s.route, ifSet }))}
            </label>
            <label>
              otherwise
              {target(s.route.ifNot, (ifNot) => s.route.type === "branch" && setRoute({ ...s.route, ifNot }))}
            </label>
          </div>
        )}

        {s.route.type === "end" && (
          <div className="grid2" style={{ marginTop: 8 }}>
            <label>
              Ending name (Arabic, optional)
              <input dir="rtl" value={s.route.ending?.ar ?? ""} maxLength={LIMITS.label} onChange={(e) => setRoute({ type: "end", ending: { ar: e.target.value, en: s.route.type === "end" ? (s.route.ending?.en ?? "") : "" } })} placeholder="النهاية السعيدة" />
            </label>
            <label>
              Ending name (English, optional)
              <input value={s.route.ending?.en ?? ""} maxLength={LIMITS.label} onChange={(e) => setRoute({ type: "end", ending: { en: e.target.value, ar: s.route.type === "end" ? (s.route.ending?.ar ?? "") : "" } })} placeholder="The happy ending" />
            </label>
            <p className="muted" style={{ margin: 0, fontSize: 13, gridColumn: "1 / -1" }}>
              Name it when the episode has several endings: viewers see which one they reached and can replay for the others. The next episode button shows at every ending.
            </p>
          </div>
        )}
      </fieldset>
    </div>
  );
}

/** Upload / replace / remove one file of a scene. */
export function MediaField(p: { seriesId: string; label: string; type: StoryMediaType; value: StoryMedia | null; onChange: (m: StoryMedia | null) => void; hint?: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy("0%");
    try {
      p.onChange(await uploadStoryFile(p.seriesId, file, p.type, (pct) => setBusy(`${Math.round(pct)}%`)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="story-media-field">
      <strong style={{ fontSize: 13 }}>{p.label}</strong>
      {p.value ? (
        <div className="story-media-preview">
          {p.type === "image" && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.value.url} alt="" />
          )}
          {p.type === "video" && <video src={p.value.url} muted playsInline preload="metadata" />}
          {p.type === "audio" && <audio src={p.value.url} controls preload="none" style={{ width: "100%" }} />}
          <span className="muted" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.value.name ?? ""}</span>
          <div className="row" style={{ gap: 4 }}>
            <label className="secondary small abtn" style={{ cursor: "pointer" }}>
              Replace
              <input type="file" accept={STORY_ACCEPT[p.type]} hidden onChange={(e) => void upload(e.target.files?.[0])} />
            </label>
            <button type="button" className="secondary small danger" onClick={() => p.onChange(null)}>
              Remove
            </button>
          </div>
        </div>
      ) : (
        <label
          className="story-drop"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void upload(e.dataTransfer.files?.[0]);
          }}
        >
          {busy ? `Uploading… ${busy}` : `⬆ Drop or choose`}
          <input type="file" accept={STORY_ACCEPT[p.type]} hidden disabled={Boolean(busy)} onChange={(e) => void upload(e.target.files?.[0])} />
        </label>
      )}
      {p.hint && !error && <span className="muted" style={{ fontSize: 12 }}>{p.hint}</span>}
      {error && <span style={{ color: "#b91c1c", fontSize: 12 }}>{error}</span>}
    </div>
  );
}
