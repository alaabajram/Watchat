"use client";

// Drop all episode files at once: each becomes the episode its file name says (editable before starting),
// uploads to Cloudflare Stream for the web, and free episodes also get a WhatsApp version (under 16 MB)
// made in this browser. Episodes are created as drafts if they don't exist yet.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ensureEpisodes } from "@/app/admin/content-actions";
import { compressForWhatsApp } from "./compress";
import { episodeNumberFromName, setMediaField, uploadToStorage, uploadToStream } from "./uploads";

type Row = { file: File; number: number | null; web: boolean; wa: boolean; status: string; done: boolean; error?: boolean };
type Props = { seriesId: string; seriesCode: string; freeUntil: number; streamReady: boolean };

export function BulkEpisodes({ seriesId, seriesCode, freeUntil, streamReady }: Props) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  function add(files: FileList) {
    const list = Array.from(files)
      .filter((f) => f.type.startsWith("video/"))
      .map((file) => {
        const number = episodeNumberFromName(file.name);
        return { file, number, web: streamReady, wa: number !== null && number <= freeUntil, status: "Ready", done: false };
      })
      .sort((a, b) => (a.number ?? 999) - (b.number ?? 999));
    setRows((rs) => [...rs, ...list]);
  }

  async function start() {
    setRunning(true);
    const numbers = rows.map((r) => r.number).filter((n): n is number => n !== null);
    let ids: Record<number, string> = {};
    try {
      ids = await ensureEpisodes(seriesId, numbers);
    } catch (e) {
      setRunning(false);
      alert(e instanceof Error ? e.message : "Couldn't create episodes");
      return;
    }
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.done || r.number === null) continue;
      const id = ids[r.number];
      try {
        if (r.web) {
          update(i, { status: "Uploading to Stream 0%" });
          const uid = await uploadToStream(r.file, `${seriesCode} ep ${r.number}`, (p) => update(i, { status: `Uploading to Stream ${p}%` }));
          await setMediaField("episode", id, "stream_uid", uid);
        }
        if (r.wa) {
          const blob = await compressForWhatsApp(r.file, (p) => update(i, { status: `${p.stage} ${p.pct}%` }));
          update(i, { status: "Uploading WhatsApp version…" });
          const url = await uploadToStorage("clip", seriesCode, blob, "mp4");
          await setMediaField("episode", id, "wa_video_url_ar", url);
          await setMediaField("episode", id, "wa_size_bytes", String(blob.size));
        }
        update(i, { status: `Done ✓${r.wa ? "" : ""}`, done: true });
      } catch (e) {
        update(i, { status: e instanceof Error ? e.message : "Failed", error: true });
      }
    }
    setRunning(false);
    router.refresh();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label
        style={{ border: "2px dashed #cbd5e1", borderRadius: 10, padding: 16, textAlign: "center", cursor: "pointer", background: "#f8fafc" }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files.length) add(e.dataTransfer.files);
        }}
      >
        <strong>⬆ Drop all episode videos here</strong>
        <div className="muted" style={{ fontSize: 12 }}>
          Numbers come from the file names (ep07.mp4, E12.mov, حلقة 3.mp4). Full episodes go to Cloudflare Stream for the web; episodes 1–{freeUntil} (free)
          also get a WhatsApp version under 16 MB, made in this browser.
        </div>
        <input type="file" accept="video/*" multiple style={{ display: "none" }} onChange={(e) => e.target.files && add(e.target.files)} />
      </label>
      {!streamReady && <div style={{ color: "#b45309", fontSize: 12 }}>Cloudflare Stream isn&apos;t set up in Vercel yet, so only WhatsApp versions can be made.</div>}
      {rows.length > 0 && (
        <>
          <table>
            <thead>
              <tr>
                <th>File</th>
                <th style={{ width: 90 }}>Episode</th>
                <th>Web (Stream)</th>
                <th>WhatsApp version</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.file.name}-${i}`}>
                  <td style={{ fontSize: 12 }}>
                    {r.file.name} <span className="muted">({(r.file.size / 1048576).toFixed(0)} MB)</span>
                  </td>
                  <td>
                    <input
                      type="number"
                      min={1}
                      max={999}
                      value={r.number ?? ""}
                      disabled={running || r.done}
                      onChange={(e) => update(i, { number: Number(e.target.value) || null })}
                      style={{ width: 70, borderColor: r.number === null ? "#dc2626" : undefined }}
                    />
                  </td>
                  <td>
                    <input type="checkbox" checked={r.web} disabled={running || r.done || !streamReady} onChange={(e) => update(i, { web: e.target.checked })} />
                  </td>
                  <td>
                    <input type="checkbox" checked={r.wa} disabled={running || r.done} onChange={(e) => update(i, { wa: e.target.checked })} />
                  </td>
                  <td style={{ fontSize: 12, color: r.error ? "#b91c1c" : r.done ? "#166534" : undefined }}>{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row">
            <button type="button" disabled={running || rows.every((r) => r.done) || rows.some((r) => r.number === null && !r.done)} onClick={start}>
              {running ? "Working… keep this tab open" : `Start (${rows.filter((r) => !r.done).length} files)`}
            </button>
            {!running && (
              <button type="button" className="secondary" onClick={() => setRows([])}>
                Clear
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
