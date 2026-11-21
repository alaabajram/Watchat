"use client";

// Drop all episode files at once — videos, dubs (audio) and subtitles — named by the naming rule:
//   EP07.mp4 · EP07_audio_en.mp3 · EP07_audio_gulf.mp3 · EP07_subs_en.srt
// - Videos go to Cloudflare Stream; every dub and subtitle file is added to that same video, so the player can
//   switch language (it plays one audio at a time).
// - Free episodes also get chat versions under 16 MB, made in this browser: Arabic and English. When the video
//   isn't in that language, its dub becomes the sound (or, for English, the subtitles are burned in).
// Episodes are created as drafts if they don't exist yet.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ensureEpisodes } from "@/app/admin/content-actions";
import { chatVersionPlan, classifyFile, exampleName, LANG_KEYS, LANGS, srtToVtt, TRACK_ACCEPT, type DroppedKind, type EpisodeTracks, type LangKey, type ViewerFamily } from "@/lib/storage/tracks";
import { compressForWhatsApp } from "./compress";
import { setMediaField, uploadToStorage, uploadToStream, uploadTrack } from "./uploads";

type Row = {
  file: File;
  kind: DroppedKind;
  number: number | null;
  lang: LangKey | null;
  web: boolean;
  wa: boolean;
  waEn: boolean;
  status: string;
  done: boolean;
  error?: boolean;
};
/** Dubs and subtitles already saved on each episode (links), reused for its chat versions. */
export type SavedMaterial = Record<number, EpisodeTracks>;
type Props = { seriesId: string; seriesCode: string; freeUntil: number; streamReady: boolean; original: LangKey; existing?: SavedMaterial };

const KIND_LABEL: Record<DroppedKind, string> = { video: "Video", sub: "Subtitles", audio: "Audio (dub)" };

/** The naming rule, as a small card the content team can follow (and screenshot). */
export function NamingRules({ original }: { original: LangKey }) {
  return (
    <details style={{ border: "1px solid var(--a-line, #ece8e2)", borderRadius: 12, padding: "8px 12px", background: "#fff" }}>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>📋 File naming rules for the content team</summary>
      <div style={{ display: "grid", gap: 10, marginTop: 10, fontSize: 13 }}>
        <p style={{ margin: 0 }}>
          One video per episode, in the series&apos; original language (<strong>{LANGS[original].en}</strong>). Every other language is a separate audio
          file (dub) or subtitle file, named like this:
        </p>
        <table style={{ fontSize: 13 }}>
          <tbody>
            <tr>
              <td><code>{exampleName(7, "video")}</code></td>
              <td>Episode 7 video (original language)</td>
            </tr>
            <tr>
              <td><code>{exampleName(7, "audio", "en")}</code></td>
              <td>English dub (audio only: mp3, m4a, aac or wav)</td>
            </tr>
            <tr>
              <td><code>{exampleName(7, "audio", "gulf")}</code></td>
              <td>Gulf Arabic dub</td>
            </tr>
            <tr>
              <td><code>{exampleName(7, "subs", "en")}</code></td>
              <td>English subtitles (srt or vtt)</td>
            </tr>
            <tr>
              <td><code>{exampleName(7, "subs", "ar")}</code></td>
              <td>Arabic subtitles</td>
            </tr>
          </tbody>
        </table>
        <p style={{ margin: 0 }}>
          Language codes:{" "}
          {LANG_KEYS.map((k, i) => (
            <span key={k}>
              {i > 0 && " · "}
              <code>{k}</code> {LANGS[k].en.replace(" (Standard)", "")}
            </span>
          ))}
        </p>
        <p className="muted" style={{ margin: 0 }}>
          Tips: two digits for the episode (EP07), no spaces, dubs the same length as the video. Viewers hear their own language when there&apos;s a
          dub (it replaces the original sound), otherwise they get subtitles.
        </p>
      </div>
    </details>
  );
}

export function BulkEpisodes({ seriesId, seriesCode, freeUntil, streamReady, original, existing = {} }: Props) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  /** Tracks for an episode: this batch's files (as a stand-in) plus what's already saved. */
  const tracksFor = (list: Row[], n: number): EpisodeTracks => {
    const t: EpisodeTracks = { audio: { ...(existing[n]?.audio ?? {}) }, subs: { ...(existing[n]?.subs ?? {}) } };
    for (const r of list)
      if (r.number === n && r.lang && r.kind !== "video") {
        const stub = { url: "", path: "", stream: "pending" as const };
        if (r.kind === "audio") t.audio![r.lang] = stub;
        else t.subs![LANGS[r.lang].tag] = stub;
      }
    return t;
  };
  const canChat = (list: Row[], n: number | null, family: ViewerFamily) => n !== null && chatVersionPlan(family, original, tracksFor(list, n)) !== null;

  function add(files: FileList) {
    const added: Row[] = Array.from(files).flatMap((file) => {
      const c = classifyFile(file.name, file.type);
      if (!c.kind) return [];
      return [{ file, kind: c.kind, number: c.number, lang: c.lang, web: c.kind === "video" && streamReady, wa: false, waEn: false, status: "Ready", done: false }];
    });
    setRows((rs) => {
      const all = [...rs, ...added].sort((a, b) => (a.number ?? 999) - (b.number ?? 999) || a.kind.localeCompare(b.kind));
      return all.map((r) => {
        if (r.kind !== "video" || r.done) return r;
        const free = r.number !== null && r.number <= freeUntil;
        return { ...r, wa: free && canChat(all, r.number, "ar"), waEn: free && canChat(all, r.number, "en") };
      });
    });
  }

  /** What to feed ffmpeg for one chat version: the dub as the sound, or subtitles to burn in, or nothing. */
  async function materialFor(n: number, family: ViewerFamily, list: Row[]): Promise<{ audio?: Blob; subtitlesVtt?: string } | null> {
    const plan = chatVersionPlan(family, original, tracksFor(list, n));
    if (!plan) return null;
    if (plan.kind === "original") return {};
    if (plan.kind === "dub") {
      const row = list.find((r) => r.number === n && r.kind === "audio" && r.lang === plan.lang);
      if (row) return { audio: row.file };
      const saved = existing[n]?.audio?.[plan.lang]?.url;
      const res = saved ? await fetch(saved) : null;
      return res?.ok ? { audio: await res.blob() } : null;
    }
    const row = list.find((r) => r.number === n && r.kind === "sub" && r.lang && LANGS[r.lang].tag === plan.tag);
    const text = row ? await row.file.text() : await fetch(existing[n]?.subs?.[plan.tag]?.url ?? "").then((r) => (r.ok ? r.text() : ""), () => "");
    if (!text) return null;
    return { subtitlesVtt: text.trimStart().startsWith("WEBVTT") ? text : srtToVtt(text) };
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
    // Dubs and subtitles first (the chat versions may need them), then the videos.
    const order = list.map((_, i) => i).sort((a, b) => Number(list[a].kind === "video") - Number(list[b].kind === "video"));
    for (const i of order) {
      const r = list[i];
      if (r.done || r.number === null) continue;
      const id = ids[r.number];
      try {
        if (r.kind !== "video") {
          if (!r.lang) throw new Error("Pick the language");
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
        for (const [family, want, field] of [
          ["ar", r.wa, "wa_video_url_ar"],
          ["en", r.waEn, "wa_video_url_en"],
        ] as const) {
          if (!want) continue;
          const m = await materialFor(r.number, family, list);
          if (!m) continue;
          const name = family === "ar" ? "Arabic" : "English";
          const blob = await compressForWhatsApp(r.file, (p) => update(i, { status: `${name} chat version: ${p.stage} ${p.pct}%` }), m);
          update(i, { status: `Uploading ${name} chat version…` });
          const url = await uploadToStorage("clip", seriesCode, blob, "mp4");
          await setMediaField("episode", id, field, url);
          if (family === "ar") await setMediaField("episode", id, "wa_size_bytes", String(blob.size));
        }
        update(i, { status: "Done ✓", done: true });
      } catch (e) {
        update(i, { status: e instanceof Error ? e.message : "Failed", error: true });
      }
    }
    setRunning(false);
    router.refresh();
  }

  const missing = rows.some((r) => !r.done && (r.number === null || (r.kind !== "video" && !r.lang)));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <NamingRules original={original} />
      <label
        style={{ border: "2px dashed #cbd5e1", borderRadius: 10, padding: 16, textAlign: "center", cursor: "pointer", background: "#f8fafc" }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files.length) add(e.dataTransfer.files);
        }}
      >
        <strong>⬆ Drop the episode videos, dubs and subtitles here</strong>
        <div className="muted" style={{ fontSize: 12 }}>
          Named like <code>EP07.mp4</code>, <code>EP07_audio_en.mp3</code>, <code>EP07_subs_en.srt</code>. Episodes 1–{freeUntil} also get chat versions
          (Arabic and English) made here.
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
                <th style={{ width: 80 }}>Episode</th>
                <th>What · language</th>
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
                      style={{ width: 64, borderColor: r.number === null ? "#dc2626" : undefined }}
                    />
                  </td>
                  <td style={{ fontSize: 13 }}>
                    {r.kind === "video" ? (
                      <>Video · {LANGS[original].en}</>
                    ) : (
                      <>
                        {KIND_LABEL[r.kind]}{" "}
                        <select
                          value={r.lang ?? ""}
                          disabled={running || r.done}
                          onChange={(e) => update(i, { lang: (e.target.value || null) as LangKey | null })}
                          style={{ borderColor: r.lang ? undefined : "#dc2626" }}
                        >
                          <option value="">Language?</option>
                          {LANG_KEYS.filter((k) => r.kind === "audio" || ["ar", "en", "fr", "tr", "hi", "ur", "ko", "es"].includes(k)).map((k) => (
                            <option key={k} value={k}>
                              {LANGS[k].en}
                            </option>
                          ))}
                        </select>
                      </>
                    )}
                  </td>
                  {r.kind === "video" ? (
                    <>
                      <td>
                        <input type="checkbox" checked={r.web} disabled={running || r.done || !streamReady} onChange={(e) => update(i, { web: e.target.checked })} />
                      </td>
                      <td>
                        <input type="checkbox" checked={r.wa} disabled={running || r.done || !canChat(rows, r.number, "ar")} title={canChat(rows, r.number, "ar") ? "" : "Needs an Arabic dub for this episode"} onChange={(e) => update(i, { wa: e.target.checked })} />
                      </td>
                      <td>
                        <input type="checkbox" checked={r.waEn} disabled={running || r.done || !canChat(rows, r.number, "en")} title={canChat(rows, r.number, "en") ? "" : "Needs an English dub or English subtitles"} onChange={(e) => update(i, { waEn: e.target.checked })} />
                      </td>
                    </>
                  ) : (
                    <td colSpan={3} className="muted" style={{ fontSize: 12 }}>
                      Added to the web video
                    </td>
                  )}
                  <td style={{ fontSize: 12, color: r.error ? "#b91c1c" : r.done ? "#166534" : undefined }}>{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {missing && <div style={{ color: "#b91c1c", fontSize: 12 }}>Fill in the red boxes (episode number or language), or rename the files by the rule.</div>}
          <div className="row">
            <button type="button" disabled={running || rows.every((r) => r.done) || missing} onClick={start}>
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
