"use client";

// Series artwork in every size the system uses, made from one master picture. The master is a new file or an
// artwork already saved (e.g. the poster), so nothing is uploaded twice. For each size choose "Fill" (cut around
// the focus point) or "Whole picture" (the full master over a blurred copy of itself: a vertical poster still
// works as a wide banner), see every size before saving, or upload a size directly.

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { artworkAsMaster } from "@/app/admin/content-actions";
import { fillSource, fitTarget, suggestedMode, type FitMode } from "@/lib/artwork";
import { ARTWORK_SLOTS, type ArtworkField } from "@/lib/content-meta";
import { setMediaField, uploadToStorage } from "./uploads";

type Props = { seriesId: string; seriesCode: string; current: Partial<Record<ArtworkField, string | null>> };

/** Draw one size from the master. `scale` < 1 makes a small preview with the same layout. */
function draw(img: HTMLImageElement, w: number, h: number, mode: FitMode, fx: number, fy: number, scale = 1): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  const mw = img.naturalWidth;
  const mh = img.naturalHeight;
  if (mode === "fill") {
    const r = fillSource(mw, mh, w, h, fx, fy);
    ctx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, canvas.width, canvas.height);
    return canvas;
  }
  // Background: the master filling the size, blurred and slightly darkened.
  const bg = fillSource(mw, mh, w, h, fx, fy);
  ctx.filter = `blur(${Math.round(28 * scale)}px) brightness(0.7)`;
  const pad = 40 * scale; // drawn a bit larger so the blur has no soft edges
  ctx.drawImage(img, bg.x, bg.y, bg.w, bg.h, -pad, -pad, canvas.width + 2 * pad, canvas.height + 2 * pad);
  ctx.filter = "none";
  // The whole master in the middle, with a soft shadow.
  const t = fitTarget(mw, mh, w, h, 0.04);
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 30 * scale;
  ctx.drawImage(img, t.x * scale, t.y * scale, t.w * scale, t.h * scale);
  return canvas;
}

const toBlob = (c: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't make the picture"))), "image/jpeg", 0.9));

export function ArtworkSlots({ seriesId, seriesCode, current }: Props) {
  const router = useRouter();
  const [master, setMaster] = useState<{ src: string; label: string } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [focus, setFocus] = useState({ x: 0.5, y: 0.4 });
  const [modes, setModes] = useState<Partial<Record<ArtworkField, FitMode>>>({});
  const [previews, setPreviews] = useState<Partial<Record<ArtworkField, string>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const img = useRef<HTMLImageElement>(null);

  const modeOf = useCallback(
    (field: ArtworkField): FitMode => {
      const slot = ARTWORK_SLOTS.find((s) => s.field === field)!;
      const i = img.current;
      return modes[field] ?? (i && loaded ? suggestedMode(i.naturalWidth, i.naturalHeight, slot.w, slot.h) : "fill");
    },
    [modes, loaded],
  );

  // Live previews of every size whenever the master, focus or a mode changes.
  useEffect(() => {
    const i = img.current;
    if (!master || !loaded || !i) return setPreviews({});
    const out: Partial<Record<ArtworkField, string>> = {};
    for (const slot of ARTWORK_SLOTS) {
      const scale = 260 / Math.max(slot.w, slot.h);
      out[slot.field] = draw(i, slot.w, slot.h, modeOf(slot.field), focus.x, focus.y, scale).toDataURL("image/jpeg", 0.8);
    }
    setPreviews(out);
  }, [master, loaded, focus, modeOf]);

  async function save(field: ArtworkField, blob: Blob, ext: string) {
    const url = await uploadToStorage("artwork", seriesCode, blob, ext);
    await setMediaField("series", seriesId, field, url);
  }

  async function fromMaster(fields: ArtworkField[]) {
    const i = img.current;
    if (!i) return;
    setBusy("master");
    try {
      for (const f of fields) {
        const slot = ARTWORK_SLOTS.find((s) => s.field === f)!;
        setStatus(`Saving ${slot.label}…`);
        await save(f, await toBlob(draw(i, slot.w, slot.h, modeOf(f), focus.x, focus.y)), "jpg");
      }
      setStatus(`Saved ${fields.length === 1 ? "✓" : `${fields.length} sizes ✓`}`);
      router.refresh();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  async function useExisting(field: ArtworkField) {
    setBusy("load");
    setStatus("Loading…");
    try {
      const src = await artworkAsMaster(seriesId, field);
      setLoaded(false);
      setModes({});
      setMaster({ src, label: ARTWORK_SLOTS.find((s) => s.field === field)!.label });
      setStatus(null);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Couldn't load it");
    } finally {
      setBusy(null);
    }
  }

  const saved = ARTWORK_SLOTS.filter((s) => current[s.field]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ minWidth: 260, maxWidth: 340, display: "grid", gap: 8 }}>
          <strong>1. Pick the master picture</strong>
          <label className="abtn secondary" style={{ cursor: "pointer", display: "inline-block", textAlign: "center" }}>
            ⬆ Upload a picture (largest you have)
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                setLoaded(false);
                setModes({});
                setMaster({ src: URL.createObjectURL(f), label: f.name });
              }}
            />
          </label>
          {saved.length > 0 && (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
              <span className="muted" style={{ fontSize: 12 }}>or use a saved one:</span>
              {saved.map((s) => (
                <button key={s.field} type="button" className="secondary" style={{ padding: "2px 8px", fontSize: 12 }} disabled={busy !== null} onClick={() => void useExisting(s.field)}>
                  {s.label}
                </button>
              ))}
            </div>
          )}
          {master && (
            <div>
              <div style={{ position: "relative", display: "inline-block", cursor: "crosshair" }} title="Click to set the focus point (faces, title)">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  ref={img}
                  src={master.src}
                  alt="Master"
                  onLoad={() => setLoaded(true)}
                  style={{ maxWidth: 320, maxHeight: 340, display: "block", borderRadius: 8 }}
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setFocus({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
                  }}
                />
                <span style={{ position: "absolute", left: `${focus.x * 100}%`, top: `${focus.y * 100}%`, transform: "translate(-50%,-50%)", width: 18, height: 18, borderRadius: "50%", border: "3px solid #fff", boxShadow: "0 0 0 2px #e4572e", pointerEvents: "none" }} />
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                Master: {master.label}
                {img.current && loaded ? ` · ${img.current.naturalWidth}×${img.current.naturalHeight}` : ""}. Click it to choose what stays in the cut sizes.
              </div>
              <button type="button" disabled={busy !== null || !loaded} onClick={() => void fromMaster(ARTWORK_SLOTS.map((s) => s.field))} style={{ marginTop: 6 }}>
                Save all sizes from the master
              </button>
            </div>
          )}
        </div>

        <div style={{ display: "grid", gap: 8, flex: 1, minWidth: 0 }}>
          <strong>{master ? "2. Check each size (Fill cuts it, Whole picture keeps everything)" : "Sizes"}</strong>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 10 }}>
            {ARTWORK_SLOTS.map((slot) => {
              const url = current[slot.field];
              const preview = previews[slot.field];
              const mode = modeOf(slot.field);
              return (
                <div key={slot.field} style={{ border: `1px solid ${preview ? "#1e1b26" : "#e5e7eb"}`, borderRadius: 8, padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                  <strong style={{ fontSize: 13 }}>{slot.label}</strong>
                  <span className="muted" style={{ fontSize: 11 }}>
                    {slot.w}×{slot.h} · {slot.use}
                  </span>
                  <div style={{ aspectRatio: `${slot.w} / ${slot.h}`, background: "#f1f5f9", borderRadius: 6, overflow: "hidden", maxHeight: 220, display: "grid", placeItems: "center" }}>
                    {preview || url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={preview ?? url!} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <span className="muted" style={{ fontSize: 12 }}>Empty</span>
                    )}
                  </div>
                  {preview && (
                    <>
                      <span className="muted" style={{ fontSize: 11 }}>{url ? "Preview (not saved yet; the saved one is replaced when you save)" : "Preview (not saved yet)"}</span>
                      <div style={{ display: "flex", gap: 4 }}>
                        {(["fill", "fit"] as const).map((m) => (
                          <button key={m} type="button" className={mode === m ? undefined : "secondary"} style={{ padding: "2px 8px", fontSize: 12 }} onClick={() => setModes((x) => ({ ...x, [slot.field]: m }))}>
                            {m === "fill" ? "Fill" : "Whole picture"}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {preview && (
                      <button type="button" style={{ padding: "2px 8px", fontSize: 12 }} disabled={busy !== null} onClick={() => void fromMaster([slot.field])}>
                        Save this size
                      </button>
                    )}
                    <label className="abtn secondary" style={{ padding: "2px 8px", fontSize: 12, cursor: "pointer" }}>
                      Upload own
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        style={{ display: "none" }}
                        onChange={async (e) => {
                          const f = e.target.files?.[0];
                          e.target.value = "";
                          if (!f) return;
                          setBusy(slot.field);
                          setStatus(`Uploading ${slot.label}…`);
                          try {
                            const ext = f.type === "image/png" ? "png" : f.type === "image/webp" ? "webp" : "jpg";
                            await save(slot.field, f, ext);
                            setStatus("Saved ✓");
                            router.refresh();
                          } catch (err) {
                            setStatus(err instanceof Error ? err.message : "Upload failed");
                          } finally {
                            setBusy(null);
                          }
                        }}
                      />
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {status && <span className="muted">{status}</span>}
    </div>
  );
}
