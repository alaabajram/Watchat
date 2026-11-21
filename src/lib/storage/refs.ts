// Where uploaded files live (pure: used by server actions, the browser upload helper and tests).
//
// Images (JPG / PNG / WebP) → Cloudflare Images, served from imagedelivery.net in their original format.
// Everything else (WhatsApp videos, trailers, subtitles) → Cloudflare R2, a plain public file link that
// WhatsApp and Telegram can download byte-for-byte (compressed videos must stay under 16 MB).
// Full web episodes go to Cloudflare Stream (separate, see createStreamUpload).
// Until Cloudflare is set up, uploads fall back to the Supabase "media" bucket.

export type StorageProvider = "images" | "r2" | "supabase";

/** What the browser needs to send one file. */
export type UploadTarget = {
  provider: StorageProvider;
  /** POST multipart (`file` field) for Images, PUT raw body for R2, PUT multipart for Supabase. */
  method: "POST" | "PUT";
  url: string;
  /** Saved alongside the URL so the file can be deleted later: "cfimg:<id>", "r2:<key>" or a Supabase path. */
  path: string;
  publicUrl: string;
};

/** The variant every Watchat image is served through: original format, at most 2560 px on the long side. */
export const IMAGE_VARIANT = "watchat";

export const IMAGE_EXTS = ["jpg", "jpeg", "png", "webp"] as const;
export const isImageExt = (ext: string) => (IMAGE_EXTS as readonly string[]).includes(ext.toLowerCase());

export const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  mp4: "video/mp4",
  vtt: "text/vtt",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
};

export const imageUrl = (accountHash: string, id: string) => `https://imagedelivery.net/${accountHash}/${id}/${IMAGE_VARIANT}`;
export const r2Url = (publicBase: string, key: string) => `${publicBase.replace(/\/+$/, "")}/${key.split("/").map(encodeURIComponent).join("/")}`;

/** Which provider holds a saved path. */
export function providerOf(path: string): StorageProvider {
  if (path.startsWith("cfimg:")) return "images";
  if (path.startsWith("r2:")) return "r2";
  return "supabase";
}

/** A Supabase public "media" URL → its object path, or null when it isn't one. */
export function supabaseMediaPath(url: string): string | null {
  const m = /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/public\/media\/(.+)$/i.exec(url.split("?")[0]);
  return m ? decodeURIComponent(m[1]) : null;
}

/** All Supabase "media" links in a text or JSON blob (for moving old files to Cloudflare). */
export function findSupabaseMediaUrls(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/public\/media\/[^"'\s)\\]+/gi)) out.add(m[0]);
  return [...out];
}

export const extOf = (path: string) => (path.split("?")[0].split(".").pop() ?? "").toLowerCase();
