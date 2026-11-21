"use client";

// Drop all episode files at once — videos, subtitle files (.vtt / .srt) and dubbed audio (.mp3 / .m4a / .wav).
// Each file goes to the episode its name says (editable before starting): ep07.mp4, ep07.en.srt, ep07_english.mp3.
// - Videos go to Cloudflare Stream for the web player; subtitles and audio are attached to that same video, so the
//   player switches language without a second upload.
// - Free episodes also get WhatsApp / Telegram versions (under 16 MB, made in this browser): the Arabic one, and an
//   English one when the episode has an English dub (used as its sound) or English subtitles (burned in).
// Episodes are created as drafts if they don't exist yet.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ensureEpisodes } from "@/app/admin/content-actions";
import { classifyFile, TRACK_ACCEPT, type DroppedKind, type TrackLang } from "@/lib/storage/tracks";
import { compressForWhatsApp } from "./compress";
import { setMediaField, uploadToStorage, uploadToStream, uploadTrack } from "./uploads";

type Row = {
  file: File;
  kind: DroppedKind;
  number: number | null;
  lang: TrackLang;
  web: boolean;
  wa: boolean;
  waEn: boolean;
  status: string;
  done: boolean;
  error?: boolean;
};
/** English material already saved on an episode (links), used for its English chat version. */
export type EnglishMaterial = Record<number, { subsEn?: string; audioEn?: string }>;
type Props = { seriesId: string; seriesCode: string; freeUntil: number; streamReady: boolean; existing?: EnglishMaterial };

const KIND_LABEL: Record<DroppedKind, string> = { video: "Video", sub: "Subtitles", audio: "Audio (dub)" };
const LANG_LABEL: Record<TrackLang, string> = { en: "English", ar: "Arabic" };

export function BulkEpisodes({ seriesId, seriesCode, freeUntil, streamReady, existing = {} }: Props) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  /** Is there English material (dub or subtitles) for this episode, in this batch or already saved? */
  const hasEnglish = (list: Row[], n: number | null) =>
    n !== null && (list.some((r) => r.number === n && r.kind !== "video" && r.lang === "en") || Boolean(existing[n]?.subsEn || existing[n]?.audioEn));

  function add(files: FileList) {
    const added: Row[] = Array.from(files).flatMap((file) => {
      const c = classifyFile(file.name, file.type);
      if (!c.kind) return [];
      return [{ file, kind: c.kind, number: c.number, lang: c.lang, web: c.kind === "video" && streamReady, wa: false, waEn: false, status: "Ready", done: false }];
    });
    setRows((rs) => {
      const all = [...rs, ...added].sort((a, b) => (a.number ?? 999) - (b.number ?? 999) || a.kind.localeCompare(b.kind));
      // Chat versions for the free episodes; the English one only when there's English material for it.
      return all.map((r) =>
        r.kind !== "video" || r.done ? r : { ...r, wa: r.number !== null && r.number <= freeUntil, waEn: r.number !== null && r.number <= freeUntil && hasEnglish(all, r.number) },
      );
    });
  }

  async function englishFor(n: number, list: Row[]): Promise<{ audio?: Blob; subtitlesVtt?: string } | null> {
    const audioRow = list.find((r) => r.number === n && r.kind === "audio" && r.lang === "en");
    const subRow = list.find((r) => r.number === n && r.kind === "sub" && r.lang === "en");
    // A dub replaces the sound (no subtitles needed); otherwise burn in the English subtitles.
    if (audioRow) return { audio: audioRow.file };
    if (existing[n]?.audioEn) {
      const r = await fetch(existing[n].audioEn!);
      if (r.ok) return { audio: await r.blob() };
    }
    if (subRow) {
      const { srtToVtt } = await import("@/lib/storage/tracks");
      const text = await subRow.file.text();
      return { subtitlesVtt: text.trimStart().startsWith("WEBVTT") ? text : srtToVtt(text) };
    }
    if (existing[n]?.subsEn) {
      const r = await fetch(existing[n].subsEn!);
      if (r.ok) return { subtitlesVtt: await r.text() };
    }
    return null;
  }

  async function start() {
    setRunning(true);
    const list = rows;
    const numbers = list.map((r) => r.number).filter((n): n is number => n !== null);
    let ids: Record<number, string> = {};
    try {
      ids = await ensureEpisodes(seriesId, numbers);
    } catch (e) {
      setRunning(false);
      alert(e instanceof Error ? e.message : "Couldn't create episodes");
      return;
    }
    // Subtitles and audio first (small), then the videos (they may need the English material).
    const order = list.map((r, i) => i).sort((a, b) => Number(list[a].kind === "video") - Number(list[b].kind === "video"));
    for (const i of order) {
      const r = list[i];
      if (r.done || r.number === null) continue;
      const id = ids[r.number];
      try {
        if (r.kind !== "video") {
          update(i, { status: "Uploading…" });
          const res = await uploadTrack(id, seriesCode, r.kind === "sub" ? "subs" : "audio", r.lang, r.file);
          update(i, {
            status: res.state === "attached" ? "Done ✓ added to the web video" : res.state === "pending" ? "Saved ✓ · added once the web video is processed" : `Saved · ${res.error ?? "couldn't add to the video yet"}`,
            done: true,
          });
          continue;
        }
        if (r.web) {
          update(i, { status: "Uploading to Stream 0%" });
          const uid = await uploadToStream(r.file, `${seriesCode} ep ${r.number}`, (p) => update(i, { status: `Uploading to Stream ${p}%` }));
          await setMediaField("episode", id, "stream_uid", uid);
        }
        if (r.wa) {
          const blob = await compressForWhatsApp(r.file, (p) => update(i, { status: `Arabic chat version: ${p.stage} ${p.pct}%` }));
          update(i, { status: "Uploading Arabic chat version…" });
          const url = await uploadToStorage("clip", seriesCode, blob, "mp4");
          await setMediaField("episode", id, "wa_video_url_ar", url);
          await setMediaField("episode", id, "wa_size_bytes", String(blob.size));
        }
        if (r.waEn) {
          const en = await englishFor(r.number, list);
          if (en) {
            const blob = await compressForWhatsApp(r.file, (p) => update(i, { status: `English chat version: ${p.stage} ${p.pct}%` }), en);
            update(i, { status: "Uploading English chat version…" });
            const url = await uploadToStorage("clip", seriesCode, blob, "mp4");
            await setMediaField("episode", id, "wa_video_url_en", url);
          }
        }
        update(i, { status: "Done ✓", done: true });
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
        <strong>⬆ Drop the episode videos here, with any subtitles and dubbed audio</strong>
        <div className="muted" style={{ fontSize: 12 }}>
          The episode number comes from each file name: ep07.mp4, ep07.en.srt, ep07_english.mp3, حلقة 3.mp4. Subtitles and audio are English unless
          the name says Arabic (ep07.ar.vtt). Videos go to the web player, and subtitles / dubs are added to that same video. Episodes 1–{freeUntil} also get
          chat versions under 16 MB: Arabic, plus English when there&apos;s a dub (used as the sound) or English subtitles (shown in the picture).
        </div>
        <input type="file" accept={`video/*,${TRACK_ACCEPT}`} multiple style={{ display: "none" }} onChange={(e) => e.target.files && add(e.target.files)} />
      </label>
      {!streamReady && <div style={{ color: "#b45309", fontSize: 12 }}>Cloudflare Stream isn&apos;t set up in Vercel yet, so only chat versions can be made.</div>}
      {rows.length > 0 && (
        <>
          <table>
            <thead>
              <tr>
                <th>File</th>
                <th style={{ width: 90 }}>Episode</th>
                <th>What</th>
                <th>Web</th>
                <th>Arabic chat</th>
                <th>English chat</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.file.name}-${i}`}>
                  <td style={{ fontSize: 12 }}>
                    {r.file.name} <span className="muted">({(r.file.size / 1048576).toFixed(r.file.size < 1048576 ? 2 : 0)} MB)</span>
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
                  <td style={{ fontSize: 13 }}>
                    {KIND_LABEL[r.kind]}
                    {r.kind !== "video" && (
                      <select value={r.lang} disabled={running || r.done} onChange={(e) => update(i, { lang: e.target.value as TrackLang })} style={{ marginInlineStart: 6 }}>
                        <option value="en">{LANG_LABEL.en}</option>
                        <option value="ar">{LANG_LABEL.ar}</option>
                      </select>
                    )}
                  </td>
                  {r.kind === "video" ? (
                    <>
                      <td>
                        <input type="checkbox" checked={r.web} disabled={running || r.done || !streamReady} onChange={(e) => update(i, { web: e.target.checked })} />
                      </td>
                      <td>
                        <input type="checkbox" checked={r.wa} disabled={running || r.done} onChange={(e) => update(i, { wa: e.target.checked })} />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={r.waEn}
                          disabled={running || r.done || !hasEnglish(rows, r.number)}
                          title={hasEnglish(rows, r.number) ? "" : "Add an English dub or English subtitles for this episode"}
                          onChange={(e) => update(i, { waEn: e.target.checked })}
                        />
                      </td>
                    </>
                  ) : (
                    <td colSpan={3} className="muted" style={{ fontSize: 12 }}>
                      Added to the web video{r.lang === "en" ? "; used for the English chat version" : ""}
                    </td>
                  )}
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
