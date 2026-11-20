"use client";

// Makes the WhatsApp version of an episode in the browser (ffmpeg.wasm, served from /ffmpeg):
// longest side 960 px, H.264 + AAC, fast-start MP4, with the bitrate worked out from the episode's
// length so the file stays under WhatsApp's 16 MB limit. Nothing leaves the computer until upload.

import type { FFmpeg } from "@ffmpeg/ffmpeg";

export const WA_MAX_BYTES = 16 * 1024 * 1024;
const TARGET_BYTES = 15 * 1000 * 1000; // headroom under 16 MiB
const AUDIO_KBPS = 64;

let ffmpeg: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;

async function load(): Promise<FFmpeg> {
  if (ffmpeg) return ffmpeg;
  loading ??= (async () => {
    // Loaded at runtime from our own site (see scripts/copy-ffmpeg.mjs), not bundled.
    const url = `${location.origin}/ffmpeg/lib/index.js`;
    const mod = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url)) as typeof import("@ffmpeg/ffmpeg");
    const f = new mod.FFmpeg();
    await f.load({ coreURL: `${location.origin}/ffmpeg/ffmpeg-core.js`, wasmURL: `${location.origin}/ffmpeg/ffmpeg-core.wasm` });
    ffmpeg = f;
    return f;
  })();
  return loading;
}

export function videoDuration(file: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(v.src);
      resolve(v.duration);
    };
    v.onerror = () => reject(new Error("Couldn't read this video."));
    v.src = URL.createObjectURL(file);
  });
}

/** Video bitrate (kbps) that keeps a clip of this length under the target size. */
export function bitrateFor(seconds: number, targetBytes = TARGET_BYTES): number {
  const totalKbps = (targetBytes * 8) / 1000 / Math.max(seconds, 1);
  return Math.floor(Math.min(1500, totalKbps - AUDIO_KBPS - 16));
}

export async function compressForWhatsApp(file: File, onProgress?: (p: { stage: string; pct: number }) => void): Promise<Blob> {
  onProgress?.({ stage: "Loading converter (first time ~30 MB)…", pct: 0 });
  const seconds = await videoDuration(file);
  let kbps = bitrateFor(seconds);
  if (kbps < 200) throw new Error(`This episode is ${Math.round(seconds / 60)} min; too long to fit WhatsApp's 16 MB at watchable quality.`);
  const f = await load();
  const onP = ({ progress }: { progress: number }) => onProgress?.({ stage: "Making WhatsApp version…", pct: Math.min(99, Math.round(progress * 100)) });
  f.on("progress", onP);
  try {
    await f.writeFile("in", new Uint8Array(await file.arrayBuffer()));
    for (let attempt = 0; attempt < 2; attempt++) {
      await f.exec([
        "-i", "in",
        "-vf", "scale='if(gt(iw,ih),960,-2)':'if(gt(iw,ih),-2,960)'",
        "-c:v", "libx264", "-preset", "veryfast", "-profile:v", "main", "-pix_fmt", "yuv420p",
        "-b:v", `${kbps}k`, "-maxrate", `${Math.round(kbps * 1.2)}k`, "-bufsize", `${kbps * 2}k`,
        "-c:a", "aac", "-b:a", `${AUDIO_KBPS}k`, "-ac", "2",
        "-movflags", "+faststart",
        "-y", "out.mp4",
      ]);
      const out = await f.readFile("out.mp4");
      const bytes = out as Uint8Array;
      const blob = new Blob([new Uint8Array(bytes)], { type: "video/mp4" }); // copy into a plain ArrayBuffer
      if (blob.size <= WA_MAX_BYTES) {
        onProgress?.({ stage: "Done", pct: 100 });
        return blob;
      }
      kbps = Math.floor(kbps * 0.8); // overshot: try once more, smaller
    }
    throw new Error("Couldn't get this video under 16 MB.");
  } finally {
    f.off("progress", onP);
    await f.deleteFile("in").catch(() => {});
    await f.deleteFile("out.mp4").catch(() => {});
  }
}
