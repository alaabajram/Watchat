"use client";

// Edits the selected card: Arabic + English texts with WhatsApp limits, buttons, media, and settings.

import { useState } from "react";
import { newId } from "@/lib/flows/defaults";
import type { Asset, TemplateInfo } from "@/lib/flows/store";
import { CARD_LABELS, type Bi, type FlowButton, type MediaRef, type NodeData } from "@/lib/flows/types";
import type { PreviewSeries } from "@/lib/flows/preview";
import { CARD_STYLE } from "./cards";
import { EmojiField } from "./EmojiField";
import { ACCEPT, uploadAsset } from "./upload";

type Props = {
  seriesId: string;
  nodeId: string;
  data: NodeData;
  onChange: (d: NodeData) => void;
  onDelete: () => void;
  onClose: () => void;
  assets: Asset[];
  addAsset: (a: Asset) => void;
  templates: TemplateInfo[];
  series: PreviewSeries;
  issues: { level: string; message: string }[];
};

const count = (s: string) => Array.from(s).length;

function Text({ label, value, onChange, max, rows = 3, dir }: { label: string; value: string; onChange: (v: string) => void; max: number; rows?: number; dir: "rtl" | "ltr" }) {
  const n = count(value);
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 12 }}>
      <span style={{ display: "flex", justifyContent: "space-between" }}>
        {label}
        <span style={{ color: n > max ? "#dc2626" : "#94a3b8" }}>
          {n}/{max}
        </span>
      </span>
      <EmojiField dir={dir} rows={rows} value={value} onChange={onChange} invalid={n > max} />
    </label>
  );
}

function BiText({ label, value, onChange, max, rows }: { label: string; value: Bi; onChange: (v: Bi) => void; max: number; rows?: number }) {
  return (
    <>
      <Text label={`${label} · Arabic`} value={value.ar} onChange={(ar) => onChange({ ...value, ar })} max={max} rows={rows} dir="rtl" />
      <Text label={`${label} · English`} value={value.en} onChange={(en) => onChange({ ...value, en })} max={max} rows={rows} dir="ltr" />
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

function MediaField({ value, onChange, seriesId, assets, addAsset, series, imageOnly }: { value: MediaRef | null; onChange: (m: MediaRef | null) => void; seriesId: string; assets: Asset[]; addAsset: (a: Asset) => void; series: PreviewSeries; imageOnly?: boolean }) {
  const [status, setStatus] = useState<string | null>(null);
  const current = !value ? "none" : "assetId" in value ? value.assetId : value.source;
  const choices = assets.filter((a) => !imageOnly || a.kind === "image");
  return (
    <fieldset style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
      <legend style={{ fontSize: 12 }}>{imageOnly ? "Image" : "Image or video"} (optional)</legend>
      <select
        value={current}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "none") onChange(null);
          else if (v === "poster") onChange({ source: "poster", type: "image" });
          else if (v === "trailer") onChange({ source: "trailer", type: "video" });
          else {
            const a = assets.find((x) => x.id === v);
            if (a) onChange({ assetId: a.id, url: a.url, type: a.kind, name: a.name });
          }
        }}
      >
        <option value="none">No media</option>
        <option value="poster">Series poster{series.posterUrl ? "" : " (not uploaded)"}</option>
        {!imageOnly && <option value="trailer">Series trailer{series.trailerUrl ? "" : " (not uploaded)"}</option>}
        {choices.map((a) => (
          <option key={a.id} value={a.id}>
            {a.kind === "video" ? "🎬" : "🖼"} {a.name}
          </option>
        ))}
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
              setStatus("Added to the card and the series library ✓");
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
                set({ condition: check === "reached_episode" ? { check: "reached_episode", episode: 4 } : { check: check as "opted_in" | "language_en" | "paid" } });
              }}
            >
              <option value="opted_in">Turned on alerts</option>
              <option value="language_en">Watches with English subtitles</option>
              <option value="paid">Has paid before</option>
              <option value="reached_episode">Reached an episode on the web</option>
            </select>
          </label>
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

      {d.kind === "template" && (
        <>
          <label style={{ fontSize: 12 }}>
            Template{" "}
            <select value={d.name} onChange={(e) => set({ name: e.target.value })}>
              <option value="">Pick a template</option>
              {p.templates.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name} · {t.approved ? "approved" : t.status.toLowerCase()}
                </option>
              ))}
            </select>
          </label>
          {p.templates.find((t) => t.name === d.name)?.bodyAr && (
            <div dir="rtl" style={{ background: "#efeae2", padding: 8, borderRadius: 8, fontSize: 13 }}>
              {p.templates.find((t) => t.name === d.name)?.bodyAr}
            </div>
          )}
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            Templates are written and sent for Meta approval on the WhatsApp templates page. Marketing templates only go to viewers who turned on alerts, at most one per 20 hours, never 22:00–09:00.
          </p>
        </>
      )}

      {d.kind !== "start" && (
        <button type="button" className="secondary" style={{ color: "#b91c1c", alignSelf: "flex-start" }} onClick={p.onDelete}>
          Delete card
        </button>
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
