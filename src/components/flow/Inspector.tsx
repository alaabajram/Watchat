"use client";

// Edits the selected card: Arabic + English texts with WhatsApp limits, buttons, media, and settings.

import { useState } from "react";
import { newId } from "@/lib/flows/defaults";
import type { Asset, TemplateInfo } from "@/lib/flows/store";
import { CARD_LABELS, type ArtSlot, type Bi, type FlowButton, type MediaRef, type NodeData, SEQUENCE_TRIGGERS } from "@/lib/flows/types";
import type { PreviewSeries } from "@/lib/flows/preview";
import { CARD_STYLE } from "./cards";
import { EmojiField } from "./EmojiField";
import { TemplatePanel } from "./TemplatePanel";
import { ACCEPT, uploadAsset } from "./upload";

type Props = {
  /** Which kind of flow the card is in: sequence flows offer their own checks and the Trigger card. */
  mode?: "series" | "sequence";
  seriesCodes?: string[];
  seriesId: string;
  nodeId: string;
  data: NodeData;
  onChange: (d: NodeData) => void;
  onDelete: () => void;
  onClose: () => void;
  assets: Asset[];
  addAsset: (a: Asset) => void;
  templates: TemplateInfo[];
  setTemplates: (t: TemplateInfo[]) => void;
  series: PreviewSeries;
  issues: { level: string; message: string }[];
  name: string;
  onRename: (name: string) => void;
  onSaveToMyCards: () => void;
};

const count = (s: string) => Array.from(s).length;

const META_TOKENS = [
  { label: "Title", text: "{title}" },
  { label: "Tagline", text: "{tagline}" },
  { label: "Genre", text: "{genre}" },
  { label: "Cast", text: "{cast}" },
];

function Text({ label, value, onChange, max, rows = 3, dir, tokens }: { label: string; value: string; onChange: (v: string) => void; max: number; rows?: number; dir: "rtl" | "ltr"; tokens?: boolean }) {
  const n = count(value);
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 12 }}>
      <span style={{ display: "flex", justifyContent: "space-between" }}>
        {label}
        <span style={{ color: n > max ? "#dc2626" : "#94a3b8" }}>
          {n}/{max}
        </span>
      </span>
      <EmojiField dir={dir} rows={rows} value={value} onChange={onChange} invalid={n > max} tokens={tokens ? META_TOKENS : undefined} />
    </label>
  );
}

function BiText({ label, value, onChange, max, rows }: { label: string; value: Bi; onChange: (v: Bi) => void; max: number; rows?: number }) {
  const tokens = max > 40; // series details from the CMS: {title} {tagline} {genre} {cast}
  return (
    <>
      <Text label={`${label} · Arabic`} value={value.ar} onChange={(ar) => onChange({ ...value, ar })} max={max} rows={rows} dir="rtl" tokens={tokens} />
      <Text label={`${label} · English`} value={value.en} onChange={(en) => onChange({ ...value, en })} max={max} rows={rows} dir="ltr" tokens={tokens} />
    </>
  );
}

function Buttons({ value, onChange }: { value: FlowButton[]; onChange: (b: FlowButton[]) => void }) {
  return (
    <fieldset style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: 8 }}>
      <legend style={{ fontSize: 12 }}>Buttons ({value.length}/3) · each one can lead to a different card</legend>
      {value.map((b, i) => (
        <div key={b.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) auto", gap: 4, marginBottom: 4 }}>
          <EmojiField compact dir="rtl" placeholder="عربي" maxLength={40} value={b.title.ar} invalid={count(b.title.ar) > 20} onChange={(v) => onChange(value.map((x, j) => (j === i ? { ...x, title: { ...x.title, ar: v } } : x)))} />
          <EmojiField compact placeholder="English" maxLength={40} value={b.title.en} invalid={count(b.title.en) > 20} onChange={(v) => onChange(value.map((x, j) => (j === i ? { ...x, title: { ...x.title, en: v } } : x)))} />
          <button type="button" className="secondary" style={{ padding: "0 8px" }} onClick={() => onChange(value.filter((_, j) => j !== i))} title="Remove button">
            ✕
          </button>
        </div>
      ))}
      {value.length < 3 && (
        <button type="button" className="secondary" style={{ padding: "2px 8px", fontSize: 12 }} onClick={() => onChange([...value, { id: newId(), title: { ar: "", en: "" } }])}>
          + Add button
        </button>
      )}
      <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Max 20 characters each. No buttons = the flow continues straight to the next card.</div>
    </fieldset>
  );
}

const ART_OPTIONS: { slot: ArtSlot; label: string }[] = [
  { slot: "banner_wa", label: "WhatsApp banner (1.91:1)" },
  { slot: "poster", label: "Poster" },
  { slot: "square", label: "Square" },
  { slot: "banner_wide", label: "Wide banner (16:9)" },
];

function mediaKey(m: MediaRef | null): string {
  if (!m) return "none";
  if ("assetId" in m) return m.assetId;
  if (m.source === "series") return `art:${m.slot}`;
  if (m.source === "episode") return `ep:${m.episode}`;
  return m.source === "poster" ? "art:poster" : "trailer";
}

function MediaField({ value, onChange, seriesId, assets, addAsset, series, imageOnly }: { value: MediaRef | null; onChange: (m: MediaRef | null) => void; seriesId: string; assets: Asset[]; addAsset: (a: Asset) => void; series: PreviewSeries; imageOnly?: boolean }) {
  const [status, setStatus] = useState<string | null>(null);
  const has = (slot: ArtSlot) => ({ poster: series.posterUrl, banner_wa: series.art?.bannerWa, banner_wide: series.art?.bannerWide, square: series.art?.square })[slot];
  const clips = Object.entries(series.clips)
    .filter(([, c]) => c.ar || c.en)
    .map(([n]) => Number(n))
    .sort((a, b) => a - b);
  const choices = assets.filter((a) => !imageOnly || a.kind === "image");
  return (
    <fieldset style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
      <legend style={{ fontSize: 12 }}>{imageOnly ? "Image" : "Image or video"} (optional)</legend>
      <select
        value={mediaKey(value)}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "none") onChange(null);
          else if (v.startsWith("art:")) onChange({ source: "series", slot: v.slice(4) as ArtSlot, type: "image" });
          else if (v === "trailer") onChange({ source: "trailer", type: "video" });
          else if (v.startsWith("ep:")) onChange({ source: "episode", episode: Number(v.slice(3)), type: "video" });
          else {
            const a = assets.find((x) => x.id === v);
            if (a) onChange({ assetId: a.id, url: a.url, type: a.kind, name: a.name });
          }
        }}
      >
        <option value="none">No media</option>
        <optgroup label="Series artwork (from the CMS)">
          {ART_OPTIONS.map((o) => (
            <option key={o.slot} value={`art:${o.slot}`}>
              {o.label}
              {has(o.slot) ? "" : o.slot === "poster" ? " (not uploaded)" : " (not uploaded: uses poster)"}
            </option>
          ))}
        </optgroup>
        {!imageOnly && (
          <optgroup label="Videos (from the CMS)">
            <option value="trailer">Trailer{series.trailerUrl ? "" : " (not uploaded)"}</option>
            {clips.map((n) => (
              <option key={n} value={`ep:${n}`}>
                Episode {n} WhatsApp clip
              </option>
            ))}
          </optgroup>
        )}
        {choices.length > 0 && (
          <optgroup label="Media library">
            {choices.map((a) => (
              <option key={a.id} value={a.id}>
                {a.kind === "video" ? "🎬" : "🖼"} {a.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <label style={{ fontSize: 12, cursor: "pointer", color: "#2563eb" }}>
        ⬆ Upload new {imageOnly ? "image" : "image or video"} to this card
        <input
          type="file"
          accept={imageOnly ? "image/jpeg,image/png" : ACCEPT}
          style={{ display: "none" }}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            try {
              setStatus("Uploading…");
              const a = await uploadAsset(seriesId, f);
              addAsset(a);
              onChange({ assetId: a.id, url: a.url, type: a.kind, name: a.name });
              setStatus("Added to the card and the series media library ✓");
            } catch (err) {
              setStatus(err instanceof Error ? err.message : "Upload failed");
            }
          }}
        />
      </label>
      {status && <span className="muted" style={{ fontSize: 12 }}>{status}</span>}
    </fieldset>
  );
}

export function Inspector(p: Props) {
  const d = p.data;
  const set = (patch: Partial<NodeData>) => p.onChange({ ...d, ...patch } as NodeData);
  const style = CARD_STYLE[d.kind];
  const epOptions = Array.from({ length: Math.max(p.series.episodeCount, 1) }, (_, i) => i + 1);
  const mediaProps = { seriesId: p.seriesId, assets: p.assets, addAsset: p.addAsset, series: p.series };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ background: style.color, color: "#fff", borderRadius: 6, padding: "2px 8px" }}>
          {style.icon} {CARD_LABELS[d.kind]}
        </span>
        <span style={{ flex: 1 }} />
        <button type="button" className="secondary" style={{ padding: "2px 8px" }} onClick={p.onClose}>
          Close
        </button>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>{style.help}</p>
      {d.kind !== "start" && (
        <label style={{ fontSize: 12 }}>
          Card name (optional, shown on the canvas)
          <input value={p.name} maxLength={60} dir="auto" placeholder={`e.g. ${d.kind === "message" ? "Hook after episode 2" : d.kind === "wait" ? "Wait 2 hours" : "Cliffhanger link"}`} onChange={(e) => p.onRename(e.target.value)} />
        </label>
      )}
      {p.issues.map((i, k) => (
        <div key={k} style={{ fontSize: 12, color: i.level === "error" ? "#b91c1c" : "#b45309" }}>
          {i.level === "error" ? "⛔" : "⚠️"} {i.message}
        </div>
      ))}

      {d.kind === "message" && (
        <>
          <MediaField value={d.media} onChange={(media) => set({ media })} {...mediaProps} />
          <BiText label={d.media && !d.buttons.length ? "Caption" : "Message"} value={d.body} onChange={(body) => set({ body })} max={1024} rows={4} />
          <Buttons value={d.buttons} onChange={(buttons) => set({ buttons })} />
        </>
      )}

      {d.kind === "language" && (
        <>
          <MediaField value={d.media} onChange={(media) => set({ media })} {...mediaProps} />
          <Text label="Message (everyone sees this one; write it in Arabic and English)" value={d.body.ar} onChange={(ar) => set({ body: { ar, en: ar } })} max={1024} rows={5} dir="rtl" />
          <Text label="Arabic button" value={d.btnAr} onChange={(btnAr) => set({ btnAr })} max={20} rows={1} dir="rtl" />
          <Text label="English subtitles button" value={d.btnEn} onChange={(btnEn) => set({ btnEn })} max={20} rows={1} dir="ltr" />
          <label className="inline" style={{ fontSize: 12 }}>
            <input type="checkbox" checked={d.skipIfKnown} onChange={(e) => set({ skipIfKnown: e.target.checked })} /> Skip for viewers who already chose a language
          </label>
        </>
      )}

      {d.kind === "episode" && (
        <>
          <label style={{ fontSize: 12 }}>
            Episode{" "}
            <select value={d.episode} onChange={(e) => set({ episode: Number(e.target.value) })}>
              {epOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                  {p.series.clips[n]?.ar ? "" : " (no chat clip yet)"}
                </option>
              ))}
            </select>
          </label>
          {!p.series.clips[d.episode]?.ar && <div style={{ fontSize: 12, color: "#b45309" }}>Upload this episode&apos;s chat clip on the series page. Until then the caption is sent without video.</div>}
          <label className="inline" style={{ fontSize: 12 }}>
            <input type="checkbox" checked={d.skipIfWatched} onChange={(e) => set({ skipIfWatched: e.target.checked })} /> Skip if the viewer already watched it
            (in the chat or on the web); the flow continues via the first button
          </label>
          <BiText label="Caption ({n} = episode, {total}, {title})" value={d.caption} onChange={(caption) => set({ caption })} max={1024} rows={2} />
          <Buttons value={d.buttons} onChange={(buttons) => set({ buttons })} />
        </>
      )}

      {d.kind === "link" && (
        <>
          <label style={{ fontSize: 12 }}>
            Opens{" "}
            <select value={String(d.episode)} onChange={(e) => set({ episode: e.target.value === "resume" ? "resume" : Number(e.target.value) })}>
              <option value="resume">Where the viewer left off</option>
              {epOptions.map((n) => (
                <option key={n} value={n}>
                  Episode {n}
                </option>
              ))}
            </select>
          </label>
          {d.episode !== "resume" && (
            <label className="inline" style={{ fontSize: 12 }}>
              <input type="checkbox" checked={d.resumeIfFurther} onChange={(e) => set({ resumeIfFurther: e.target.checked })} /> Open where the viewer left off if
              they&apos;re further ahead
            </label>
          )}
          <MediaField value={d.media} onChange={(media) => set({ media })} {...mediaProps} imageOnly />
          <BiText label="Message ({next} = episode)" value={d.body} onChange={(body) => set({ body })} max={1024} rows={4} />
          <BiText label="Button" value={d.button} onChange={(button) => set({ button })} max={20} rows={1} />
        </>
      )}

      {d.kind === "optin" && (
        <>
          <BiText label="Question" value={d.body} onChange={(body) => set({ body })} max={1024} rows={3} />
          <BiText label="Yes button" value={d.yes} onChange={(yes) => set({ yes })} max={20} rows={1} />
          <BiText label="No button" value={d.no} onChange={(no) => set({ no })} max={20} rows={1} />
          <label className="inline" style={{ fontSize: 12 }}>
            <input type="checkbox" checked={d.skipIfAnswered} onChange={(e) => set({ skipIfAnswered: e.target.checked })} /> Skip for viewers who already answered
          </label>
        </>
      )}

      {d.kind === "wait" && <WaitField minutes={d.minutes} onChange={(minutes) => set({ minutes })} />}

      {d.kind === "condition" && (
        <>
          <label style={{ fontSize: 12 }}>
            Check{" "}
            <select
              value={d.condition.check}
              onChange={(e) => {
                const check = e.target.value;
                set({
                  condition:
                    check === "reached_episode"
                      ? { check: "reached_episode", episode: 4 }
                      : check === "watched_within"
                        ? { check: "watched_within", hours: 2 }
                        : { check: check as "opted_in" | "language_en" | "paid" | "started" | "came_back" | "paid_since" },
                });
              }}
            >
              {(p.mode === "sequence"
                ? [
                    ["came_back", "Came back since the sequence started (chat or web)"],
                    ["paid_since", "Paid since the sequence started"],
                    ["opted_in", "Turned on alerts"],
                    ["language_en", "Watches with English subtitles"],
                    ["paid", "Has paid before"],
                    ["watched_within", "Watched on the web recently"],
                  ]
                : [
                    ["opted_in", "Turned on alerts"],
                    ["language_en", "Watches with English subtitles"],
                    ["paid", "Has paid before"],
                    ["reached_episode", "Reached an episode on the web"],
                    ["started", "Already started this series (chat or web)"],
                    ["watched_within", "Watched on the web recently"],
                  ]
              ).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          {d.condition.check === "watched_within" && (
            <label className="inline" style={{ fontSize: 12 }}>
              In the last
              <input type="number" min={1} max={720} value={d.condition.hours} onChange={(e) => set({ condition: { check: "watched_within", hours: Math.max(1, Math.min(720, Number(e.target.value) || 1)) } })} style={{ width: 70 }} />
              hours
            </label>
          )}
          {d.condition.check === "reached_episode" && (
            <label style={{ fontSize: 12 }}>
              Episode{" "}
              <select value={d.condition.episode} onChange={(e) => set({ condition: { check: "reached_episode", episode: Number(e.target.value) } })}>
                {epOptions.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      )}

      {d.kind === "choice" && (
        <>
          <MediaField value={d.media} onChange={(media) => set({ media })} {...mediaProps} />
          <BiText label="Message" value={d.body} onChange={(body) => set({ body })} max={1024} rows={3} />
          <fieldset style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: 8, display: "flex", flexDirection: "column", gap: 8 }}>
            <legend style={{ fontSize: 12 }}>Series ({d.options.length}/3) · a tap starts that series&apos; own flow</legend>
            {d.options.map((o, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4, borderBottom: "1px dashed #e5e7eb", paddingBottom: 6 }}>
                <div style={{ display: "flex", gap: 4 }}>
                  <select
                    value={o.code}
                    onChange={(e) => set({ options: d.options.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)) })}
                    style={{ flex: 1 }}
                  >
                    <option value="AUTO">✨ Recommended (a series they haven&apos;t started)</option>
                    {(p.series.others ?? []).map((x) => (
                      <option key={x.code} value={x.code}>
                        {x.code} · {x.titleEn}
                      </option>
                    ))}
                  </select>
                  {d.options.length > 1 && (
                    <button type="button" className="secondary" style={{ padding: "0 8px" }} onClick={() => set({ options: d.options.filter((_, j) => j !== i) })} title="Remove">
                      ✕
                    </button>
                  )}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 4 }}>
                  <EmojiField compact dir="rtl" placeholder="Button (default: title)" maxLength={40} value={o.label.ar} invalid={count(o.label.ar) > 20} onChange={(v) => set({ options: d.options.map((x, j) => (j === i ? { ...x, label: { ...x.label, ar: v } } : x)) })} />
                  <EmojiField compact placeholder="English button" maxLength={40} value={o.label.en} invalid={count(o.label.en) > 20} onChange={(v) => set({ options: d.options.map((x, j) => (j === i ? { ...x, label: { ...x.label, en: v } } : x)) })} />
                </div>
              </div>
            ))}
            {d.options.length < 3 && (
              <button type="button" className="secondary" style={{ padding: "2px 8px", fontSize: 12, alignSelf: "flex-start" }} onClick={() => set({ options: [...d.options, { code: "AUTO", label: { ar: "", en: "" } }] })}>
                + Add series
              </button>
            )}
            {(p.series.others ?? []).length === 0 && <span className="muted" style={{ fontSize: 12 }}>No other live series yet; the card shows nothing until there are.</span>}
          </fieldset>
        </>
      )}

      {d.kind === "trigger" && (
        <>
          <label style={{ fontSize: 12 }}>
            When
            <select value={d.trigger} onChange={(e) => set({ trigger: e.target.value as typeof d.trigger })}>
              {SEQUENCE_TRIGGERS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="inline" style={{ fontSize: 12 }}>
            Start
            <input
              type="number"
              min={1}
              max={d.delayHours % 24 === 0 ? 90 : 2160}
              value={d.delayHours % 24 === 0 ? d.delayHours / 24 : d.delayHours}
              onChange={(e) => {
                const v = Math.max(1, Number(e.target.value) || 1);
                set({ delayHours: Math.min(2160, d.delayHours % 24 === 0 ? v * 24 : v) });
              }}
              style={{ width: 70 }}
            />
            <select value={d.delayHours % 24 === 0 ? "d" : "h"} onChange={(e) => set({ delayHours: e.target.value === "d" ? Math.max(1, Math.round(d.delayHours / 24)) * 24 : Math.max(1, Math.round(d.delayHours / 24)) })}>
              <option value="h">hours</option>
              <option value="d">days</option>
            </select>
            after that moment
          </label>
          <label style={{ fontSize: 12 }}>
            Series
            <select value={d.seriesCode ?? ""} onChange={(e) => set({ seriesCode: e.target.value || null })}>
              <option value="">Any series</option>
              {(p.seriesCodes ?? []).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            Only viewers who turned on alerts are included. Each viewer enters once per moment (e.g. once per series and episode they stopped at). The scheduler checks every 15 minutes and sends nothing between 22:00 and 09:00 Gulf time.
          </p>
        </>
      )}

      {d.kind === "template" && (
        <TemplatePanel value={d.name} onPick={(name) => set({ name })} templates={p.templates} setTemplates={p.setTemplates} seriesTitle={{ ar: p.series.titleAr, en: p.series.titleEn }} />
      )}

      {d.kind !== "start" && d.kind !== "trigger" && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" className="secondary" onClick={p.onSaveToMyCards} title="Reuse this card in any series from Add card → My cards">
            ☆ Save to My cards
          </button>
          <button type="button" className="secondary" style={{ color: "#b91c1c" }} onClick={p.onDelete}>
            Delete card
          </button>
        </div>
      )}
    </div>
  );
}

function WaitField({ minutes, onChange }: { minutes: number; onChange: (m: number) => void }) {
  const unit = minutes % 1440 === 0 ? 1440 : minutes % 60 === 0 ? 60 : 1;
  return (
    <label className="inline" style={{ fontSize: 12 }}>
      Wait
      <input type="number" min={1} value={minutes / unit} onChange={(e) => onChange(Math.max(1, Number(e.target.value) || 1) * unit)} style={{ width: 80 }} />
      <select value={unit} onChange={(e) => onChange(Math.max(1, Math.round(minutes / unit)) * Number(e.target.value))}>
        <option value={1}>minutes</option>
        <option value={60}>hours</option>
        <option value={1440}>days</option>
      </select>
    </label>
  );
}
