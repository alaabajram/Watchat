"use client";

// Edits the selected card: Arabic + English texts with WhatsApp limits, buttons, media, and settings.

import { useState } from "react";
import { newId } from "@/lib/flows/defaults";
import type { Asset, TemplateInfo } from "@/lib/flows/store";
import { CARD_LABELS, normaliseWord, SHARED_ACTIONS, type ArtSlot, type Bi, type FlowButton, type ListRow, type MediaRef, type NodeData, SEQUENCE_TRIGGERS } from "@/lib/flows/types";
import type { PreviewSeries } from "@/lib/flows/preview";
import { CARD_STYLE } from "./cards";
import { EmojiField } from "./EmojiField";
import { TemplatePanel } from "./TemplatePanel";
import { ACCEPT, uploadAsset } from "./upload";

type Props = {
  /** Which kind of flow the card is in: sequence flows offer their own checks and the Trigger card. */
  mode?: "series" | "sequence" | "shared";
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

function MediaField({
  value,
  onChange,
  seriesId,
  assets,
  addAsset,
  series,
  imageOnly,
  cms = true,
  label,
  note,
}: {
  value: MediaRef | null;
  onChange: (m: MediaRef | null) => void;
  seriesId: string;
  assets: Asset[];
  addAsset: (a: Asset) => void;
  series: PreviewSeries;
  imageOnly?: boolean;
  /** Offer the series' artwork, trailer and clips (series flows only). */
  cms?: boolean;
  label?: string;
  note?: string;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const has = (slot: ArtSlot) => ({ poster: series.posterUrl, banner_wa: series.art?.bannerWa, banner_wide: series.art?.bannerWide, square: series.art?.square })[slot];
  const clips = Object.entries(series.clips)
    .filter(([, c]) => c.ar || c.en)
    .map(([n]) => Number(n))
    .sort((a, b) => a - b);
  const choices = assets.filter((a) => !imageOnly || a.kind === "image");
  return (
    <fieldset style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
      <legend style={{ fontSize: 12 }}>{label ?? `${imageOnly ? "Image" : "Image or video"} (optional)`}</legend>
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
        {cms && (
        <optgroup label="Series artwork (from the CMS)">
          {ART_OPTIONS.map((o) => (
            <option key={o.slot} value={`art:${o.slot}`}>
              {o.label}
              {has(o.slot) ? "" : o.slot === "poster" ? " (not uploaded)" : " (not uploaded: uses poster)"}
            </option>
          ))}
        </optgroup>
        )}
        {!imageOnly && cms && (
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
              setStatus(seriesId ? "Added to the card and the series media library ✓" : "Added to the card and the media library ✓");
            } catch (err) {
              setStatus(err instanceof Error ? err.message : "Upload failed");
            }
          }}
        />
      </label>
      {status && <span className="muted" style={{ fontSize: 12 }}>{status}</span>}
      {note && <span className="muted" style={{ fontSize: 11 }}>{note}</span>}
    </fieldset>
  );
}

export function Inspector(p: Props) {
  const d = p.data;
  const set = (patch: Partial<NodeData>) => p.onChange({ ...d, ...patch } as NodeData);
  const style = CARD_STYLE[d.kind];
  const epOptions = Array.from({ length: Math.max(p.series.episodeCount, 1) }, (_, i) => i + 1);
  const mediaProps = { seriesId: p.seriesId, assets: p.assets, addAsset: p.addAsset, series: p.series, cms: (p.mode ?? "series") === "series" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span style={{ width: 34, height: 34, flex: "none", borderRadius: 11, background: `${style.color}1f`, color: style.color, display: "grid", placeItems: "center", fontSize: 17 }}>{style.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, color: "#6b6474", textTransform: "uppercase" }}>Editing</div>
          <div style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.2 }} dir="auto">
            {p.name || CARD_LABELS[d.kind].split(":")[0]}
          </div>
        </div>
        <button type="button" aria-label="Close" onClick={p.onClose} style={{ background: "#f4f2ee", color: "#1f1b24", borderRadius: 10, padding: "4px 10px", boxShadow: "none" }}>
          ✕
        </button>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 12, lineHeight: 1.45 }}>{style.help}</p>
      {d.kind !== "start" && (
        <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 3 }}>
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
          {p.mode === "shared" ? (
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              Opens the viewer&apos;s current series where they left off. Put a Condition “Following a series?” before it: viewers with no series yet get the
              account link instead.
            </p>
          ) : (
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
          )}
          {d.episode !== "resume" && p.mode !== "shared" && (
            <label className="inline" style={{ fontSize: 12 }}>
              <input type="checkbox" checked={d.resumeIfFurther} onChange={(e) => set({ resumeIfFurther: e.target.checked })} /> Open where the viewer left off if
              they&apos;re further ahead
            </label>
          )}
          <MediaField value={d.media} onChange={(media) => set({ media })} {...mediaProps} imageOnly />
          <BiText label="Message ({title} = series, {n} = episode)" value={d.body} onChange={(body) => set({ body })} max={1024} rows={4} />
          <BiText label="Button" value={d.button} onChange={(button) => set({ button })} max={20} rows={1} />
        </>
      )}

      {d.kind === "optin" && (
        <>
          <MediaField value={d.media ?? null} onChange={(media) => set({ media })} {...mediaProps} />
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
                        : { check: check as "opted_in" | "language_en" | "paid" | "started" | "came_back" | "paid_since" | "has_series" | "on_telegram" },
                });
              }}
            >
              {(p.mode === "shared"
                ? [
                    ["has_series", "Following a series (has a place to continue)"],
                    ["opted_in", "Turned on alerts"],
                    ["language_en", "Watches with English subtitles"],
                    ["paid", "Has paid before"],
                    ["on_telegram", "Viewer is on Telegram (no: WhatsApp)"],
                  ]
                : p.mode === "sequence"
                ? [
                    ["came_back", "Came back since the sequence started (chat or web)"],
                    ["paid_since", "Paid since the sequence started"],
                    ["opted_in", "Turned on alerts"],
                    ["language_en", "Watches with English subtitles"],
                    ["paid", "Has paid before"],
                    ["watched_within", "Watched on the web recently"],
                    ["on_telegram", "Viewer is on Telegram (no: WhatsApp)"],
                  ]
                : [
                    ["opted_in", "Turned on alerts"],
                    ["language_en", "Watches with English subtitles"],
                    ["paid", "Has paid before"],
                    ["reached_episode", "Reached an episode on the web"],
                    ["started", "Already started this series (chat or web)"],
                    ["watched_within", "Watched on the web recently"],
                    ["on_telegram", "Viewer is on Telegram (no: WhatsApp)"],
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

      {d.kind === "keyword" && <KeywordEditor words={d.words} anythingElse={d.anythingElse} onChange={(patch) => set(patch)} />}

      {d.kind === "list" && (
        <>
          <MediaField value={d.media ?? null} onChange={(media) => set({ media })} {...mediaProps} note="WhatsApp menus can't carry media, so it's sent just before the menu." />
          <BiText label="Message" value={d.body} onChange={(body) => set({ body })} max={1024} rows={3} />
          <BiText label="Menu button" value={d.button} onChange={(button) => set({ button })} max={20} rows={1} />
          <BiText label="List heading" value={d.section} onChange={(section) => set({ section })} max={24} rows={1} />
          <Rows value={d.rows} onChange={(rows) => set({ rows })} />
        </>
      )}

      {d.kind === "account" && (
        <>
          <MediaField value={d.media ?? null} onChange={(media) => set({ media })} {...mediaProps} imageOnly />
          <BiText label="Message" value={d.body} onChange={(body) => set({ body })} max={1024} rows={3} />
          <BiText label="Button" value={d.button} onChange={(button) => set({ button })} max={20} rows={1} />
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            The button is the viewer&apos;s own sign-in link: it opens their account page on this phone. The very first link a viewer gets also carries the pin tip
            (edit it under “Texts the bot sends by itself”).
          </p>
        </>
      )}

      {d.kind === "action" && (
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {SHARED_ACTIONS.map((a) => (
            <label key={a.value} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "8px 10px", borderRadius: 12, background: d.action === a.value ? "#e9fbf3" : "#f7f5f2", cursor: "pointer", fontSize: 13 }}>
              <input type="radio" name="action" checked={d.action === a.value} onChange={() => set({ action: a.value })} style={{ marginTop: 3 }} />
              <span>
                <strong>{a.label}</strong>
                <span className="muted" style={{ display: "block", fontSize: 12 }}>{a.help}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {d.kind === "template" && (
        <>
          <TemplatePanel value={d.name} onPick={(name) => set({ name })} templates={p.templates} setTemplates={p.setTemplates} seriesTitle={{ ar: p.series.titleAr, en: p.series.titleEn }} />
          <MediaField
            value={d.media ?? null}
            onChange={(media) => set({ media })}
            {...mediaProps}
            imageOnly
            label="Header image (optional)"
            note="Used when the template has an image header. Empty = the viewer's series WhatsApp banner (or poster)."
          />
        </>
      )}

      {d.kind === "suggest" && (
        <MediaField value={d.media ?? null} onChange={(media) => set({ media })} {...mediaProps} note="Sent just before the list of other series." />
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

function KeywordEditor({ words, anythingElse, onChange }: { words: string[]; anythingElse: boolean; onChange: (p: { words?: string[]; anythingElse?: boolean }) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const parts = draft.split(/[,،\n]/).map((w) => w.trim()).filter(Boolean);
    const next = [...words];
    for (const w of parts) if (!next.some((x) => normaliseWord(x) === normaliseWord(w))) next.push(w);
    onChange({ words: next.slice(0, 30) });
    setDraft("");
  };
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
      <legend style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Words the viewer sends</legend>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {words.map((w) => (
          <span key={w} dir="auto" style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#d9fdd3", borderRadius: 999, padding: "4px 6px 4px 12px", fontSize: 13, fontWeight: 600 }}>
            {w}
            <button type="button" aria-label={`Remove ${w}`} onClick={() => onChange({ words: words.filter((x) => x !== w) })} style={{ background: "transparent", color: "#1f1b24", padding: "0 6px", boxShadow: "none", fontSize: 12 }}>
              ✕
            </button>
          </span>
        ))}
        {!words.length && <span className="muted" style={{ fontSize: 12 }}>No words yet.</span>}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          value={draft}
          dir="auto"
          placeholder="e.g. عروض, OFFERS"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          style={{ flex: 1 }}
        />
        <button type="button" onClick={add} disabled={!draft.trim()}>
          Add
        </button>
      </div>
      <span className="muted" style={{ fontSize: 11 }}>Separate several with commas. Capitals, spaces and punctuation don&apos;t matter. Series codes always start their series.</span>
      <label className="inline" style={{ fontSize: 12, alignItems: "flex-start" }}>
        <input type="checkbox" checked={anythingElse} onChange={(e) => onChange({ anythingElse: e.target.checked })} /> Also answer anything else (messages no other card
        matches). Viewers with no series yet first get “No series yet”.
      </label>
    </fieldset>
  );
}

function Rows({ value, onChange }: { value: ListRow[]; onChange: (r: ListRow[]) => void }) {
  return (
    <fieldset style={{ border: "1px solid #ece8e2", borderRadius: 12, padding: 10 }}>
      <legend style={{ fontSize: 12 }}>Rows ({value.length}/10) · each one leads to its own card</legend>
      {value.map((r, i) => (
        <div key={r.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) auto", gap: 4, marginBottom: 4 }}>
          <EmojiField compact dir="rtl" placeholder="عربي" maxLength={40} value={r.title.ar} invalid={count(r.title.ar) > 24} onChange={(v) => onChange(value.map((x, j) => (j === i ? { ...x, title: { ...x.title, ar: v } } : x)))} />
          <EmojiField compact placeholder="English" maxLength={40} value={r.title.en} invalid={count(r.title.en) > 24} onChange={(v) => onChange(value.map((x, j) => (j === i ? { ...x, title: { ...x.title, en: v } } : x)))} />
          <button type="button" className="secondary" style={{ padding: "0 8px" }} onClick={() => onChange(value.filter((_, j) => j !== i))} title="Remove row">
            ✕
          </button>
        </div>
      ))}
      {value.length < 10 && (
        <button type="button" className="secondary" style={{ padding: "2px 8px", fontSize: 12 }} onClick={() => onChange([...value, { id: newId(), title: { ar: "", en: "" } }])}>
          + Add row
        </button>
      )}
      <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Max 24 characters each.</div>
    </fieldset>
  );
}
