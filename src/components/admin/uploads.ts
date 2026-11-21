"use client";

// Browser uploads for the CMS: pictures to Cloudflare Images, videos / subtitles to R2, full episodes to Stream.

import { sendUpload } from "@/lib/storage/send";
import { createMediaUpload, createStreamUpload, setMediaField } from "@/app/admin/content-actions";

export async function uploadToStorage(kind: "artwork" | "clip" | "poster", seriesCode: string, blob: Blob, ext: string): Promise<string> {
  const target = await createMediaUpload(kind, seriesCode, ext);
  await sendUpload(target, blob);
  return target.publicUrl;
}

/** Full episode to Cloudflare Stream (web player). Returns the Stream video id. */
export async function uploadToStream(file: File, name: string, onProgress?: (pct: number) => void): Promise<string> {
  const { uploadUrl, uid } = await createStreamUpload(name);
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", uploadUrl);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((100 * e.loaded) / e.total));
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`Stream upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("Stream upload failed (network)"));
    const body = new FormData();
    body.append("file", file);
    xhr.send(body);
  });
  return uid;
}

export { setMediaField };
export { episodeNumberFromName } from "@/lib/content-meta";
