"use client";

// Series artwork in every size the system uses. Upload one master image and crop each size from it
// (click the master to set the focus point), or upload a size directly.

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ARTWORK_SLOTS, type ArtworkField } from "@/lib/content-meta";
import { setMediaField, uploadToStorage } from "./uploads";

type Props = { seriesId: string; seriesCode: string; current: Partial<Record<ArtworkField, string | null>> };

function cropToBlob(img: HTMLImageElement, w: number, h: number, fx: number, fy: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight); // cover
  const sw = w / scale;
  const sh = h / scale;
  const sx = Math.min(Math.max(fx * img.naturalWidth - sw / 2, 0), img.naturalWidth - sw);
  const sy = Math.min(Math.max(fy * img.naturalHeight - sh / 2, 0), img.naturalHeight - sh);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Crop failed"))), "image/jpeg", 0.88));
}

export function ArtworkSlots({ seriesId, seriesCode, current }: Props) {
  const router = useRouter();
  const [master, setMaster] = useState<string | null>(null);
  const [focus, setFocus] = useState({ x: 0.5, y: 0.4 });
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const img = useRef<HTMLImageElement>(null);

  async function save(field: ArtworkField, blob: Blob, ext: string) {
    const url = await uploadToStorage("artwork", seriesCode, blob, ext);
    await setMediaField("series", seriesId, field, url);
  }

  async function fromMaster(fields: ArtworkField[]) {
    if (!img.current) return;
    setBusy("master");
    try {
      for (const f of fields) {
        const slot = ARTWORK_SLOTS.find((s) => s.field === f)!;
        setStatus(`Making ${slot.label}…`);
        await save(f, await cropToBlob(img.current, slot.w, slot.h, focus.x, focus.y), "jpg");
      }
      setStatus("Saved ✓");
      router.refresh();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ minWidth: 260 }}>
          <label className="abtn secondary" style={{ cursor: "pointer", display: "inline-block" }}>
            ⬆ Master image (largest you have)
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) setMaster(URL.createObjectURL(f));
              }}
            />
          </label>
          {master && (
            <div style={{ marginTop: 8 }}>
              <div style={{ position: "relative", display: "inline-block", cursor: "crosshair" }} title="Click to set the focus point (faces, title)">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  ref={img}
                  src={master}
                  alt="Master"
                  style={{ maxWidth: 320, maxHeight: 320, display: "block", borderRadius: 8 }}
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setFocus({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
                  }}
                />
                <span style={{ position: "absolute", left: `${focus.x * 100}%`, top: `${focus.y * 100}%`, transform: "translate(-50%,-50%)", width: 18, height: 18, borderRadius: "50%", border: "3px solid #fff", boxShadow: "0 0 0 2px #e4572e", pointerEvents: "none" }} />
              </div>
              <div className="muted" style={{ fontSize: 12 }}>Click the image to choose what stays in every crop.</div>
              <button type="button" disabled={busy !== null} onClick={() => fromMaster(ARTWORK_SLOTS.map((s) => s.field))} style={{ marginTop: 6 }}>
                Make all sizes from master
              </button>
            </div>
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 10, flex: 1 }}>
          {ARTWORK_SLOTS.map((slot) => {
            const url = current[slot.field];
            return (
              <div key={slot.field} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                <strong style={{ fontSize: 13 }}>{slot.label}</strong>
                <span className="muted" style={{ fontSize: 11 }}>
                  {slot.w}×{slot.h} · {slot.use}
                </span>
                <div style={{ aspectRatio: `${slot.w} / ${slot.h}`, background: "#f1f5f9", borderRadius: 6, overflow: "hidden", maxHeight: 220, display: "grid", placeItems: "center" }}>
                  {url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <span className="muted" style={{ fontSize: 12 }}>Empty</span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {master && (
                    <button type="button" className="secondary" style={{ padding: "2px 8px", fontSize: 12 }} disabled={busy !== null} onClick={() => fromMaster([slot.field])}>
                      Crop from master
                    </button>
                  )}
                  <label className="abtn secondary" style={{ padding: "2px 8px", fontSize: 12, cursor: "pointer" }}>
                    Upload
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
      {status && <span className="muted">{status}</span>}
    </div>
  );
}
