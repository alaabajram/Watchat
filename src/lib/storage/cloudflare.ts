// Server side of file storage: upload targets, deletes and copying old Supabase files to Cloudflare.
// See refs.ts for which file goes where.

import { AwsClient } from "aws4fetch";
import { db } from "@/lib/supabase";
import { CONTENT_TYPES, extOf, IMAGE_VARIANT, imageUrl, isImageExt, providerOf, r2Url, type UploadTarget } from "./refs";

const env = (k: string) => (process.env[k] ?? "").trim();

function imagesConfig() {
  const account = env("CLOUDFLARE_ACCOUNT_ID");
  const token = env("CLOUDFLARE_IMAGES_API_TOKEN") || env("CLOUDFLARE_STREAM_API_TOKEN");
  const hash = env("CLOUDFLARE_IMAGES_ACCOUNT_HASH");
  return account && token && hash ? { account, token, hash } : null;
}

function r2Config() {
  const account = env("R2_ACCOUNT_ID") || env("CLOUDFLARE_ACCOUNT_ID");
  const keyId = env("R2_ACCESS_KEY_ID");
  const secret = env("R2_SECRET_ACCESS_KEY");
  const bucket = env("R2_BUCKET");
  const publicBase = env("R2_PUBLIC_URL");
  return account && keyId && secret && bucket && publicBase ? { account, keyId, secret, bucket, publicBase } : null;
}

export const storageStatus = () => ({ images: Boolean(imagesConfig()), r2: Boolean(r2Config()) });

const API = "https://api.cloudflare.com/client/v4";
type CfJson<T> = { success?: boolean; result?: T; errors?: { code?: number; message: string }[] };

async function cf<T>(path: string, init: RequestInit): Promise<T> {
  const c = imagesConfig()!;
  const res = await fetch(`${API}/accounts/${c.account}${path}`, { ...init, headers: { Authorization: `Bearer ${c.token}`, ...(init.headers ?? {}) } });
  const json = (await res.json().catch(() => ({}))) as CfJson<T>;
  if (!res.ok || !json.success) throw new Error(`Cloudflare Images: ${json.errors?.[0]?.message ?? res.status}`);
  return json.result as T;
}

let variantReady = false;
/** Make sure the "watchat" variant exists: original format, up to 2560 px, public. */
async function ensureVariant() {
  if (variantReady) return;
  try {
    await cf(`/images/v1/variants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: IMAGE_VARIANT, options: { fit: "scale-down", width: 2560, height: 2560, metadata: "none" }, neverRequireSignedURLs: true }),
    });
  } catch (e) {
    // Already there is fine; anything else is a real problem (bad token, Images not enabled).
    if (!/already exists|duplicate/i.test(String(e))) {
      const ok = await cf(`/images/v1/variants/${IMAGE_VARIANT}`, { method: "GET" }).then(() => true, () => false);
      if (!ok) throw e;
    }
  }
  variantReady = true;
}

function r2Client() {
  const c = r2Config()!;
  return { c, aws: new AwsClient({ accessKeyId: c.keyId, secretAccessKey: c.secret, service: "s3", region: "auto" }) };
}
const r2ObjectUrl = (c: NonNullable<ReturnType<typeof r2Config>>, key: string) =>
  `https://${c.account}.r2.cloudflarestorage.com/${c.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;

/**
 * Where the browser should send one file. `key` is the file's path (e.g. "TEST02/artwork-…-ab12.png").
 * Images → Cloudflare Images, other files → R2; whichever isn't set up yet falls back to Supabase.
 */
export async function uploadTarget(key: string): Promise<UploadTarget> {
  const ext = extOf(key);
  const images = imagesConfig();
  if (isImageExt(ext) && images) {
    await ensureVariant();
    const form = new FormData();
    form.append("requireSignedURLs", "false");
    const r = await cf<{ id: string; uploadURL: string }>(`/images/v2/direct_upload`, { method: "POST", body: form });
    return { provider: "images", method: "POST", url: r.uploadURL, path: `cfimg:${r.id}`, publicUrl: imageUrl(images.hash, r.id) };
  }
  if (!isImageExt(ext) && r2Config()) {
    const { c, aws } = r2Client();
    const signed = await aws.sign(new Request(`${r2ObjectUrl(c, key)}?X-Amz-Expires=3600`, { method: "PUT" }), { aws: { signQuery: true } });
    return { provider: "r2", method: "PUT", url: signed.url, path: `r2:${key}`, publicUrl: r2Url(c.publicBase, key) };
  }
  const { data, error } = await db().storage.from("media").createSignedUploadUrl(key);
  if (error || !data) throw new Error(`Upload URL failed: ${error?.message}`);
  return { provider: "supabase", method: "PUT", url: data.signedUrl, path: key, publicUrl: db().storage.from("media").getPublicUrl(key).data.publicUrl };
}

/** Delete a stored file wherever it lives (missing files are fine). */
export async function deleteStored(path: string): Promise<void> {
  const p = providerOf(path);
  if (p === "images" && imagesConfig()) {
    await cf(`/images/v1/${encodeURIComponent(path.slice(6))}`, { method: "DELETE" }).catch(() => undefined);
  } else if (p === "r2" && r2Config()) {
    const { c, aws } = r2Client();
    await aws.fetch(r2ObjectUrl(c, path.slice(3)), { method: "DELETE" }).catch(() => undefined);
  } else if (p === "supabase") {
    await db().storage.from("media").remove([path]);
  }
}

/** Copy one existing file (by its public URL) to Cloudflare. Returns the new link and path, or null when not possible yet. */
export async function copyToCloudflare(url: string, key: string): Promise<{ publicUrl: string; path: string } | null> {
  const ext = extOf(key);
  const images = imagesConfig();
  if (isImageExt(ext)) {
    if (!images) return null;
    await ensureVariant();
    const form = new FormData();
    form.append("url", url);
    const r = await cf<{ id: string }>(`/images/v1`, { method: "POST", body: form });
    return { publicUrl: imageUrl(images.hash, r.id), path: `cfimg:${r.id}` };
  }
  if (!r2Config()) return null;
  const file = await fetch(url);
  if (!file.ok) throw new Error(`Couldn't read ${key} (${file.status})`);
  const { c, aws } = r2Client();
  // Sign first, then send the bytes ourselves: aws4fetch.fetch would stream the body without a length (R2 answers 411).
  const bytes = new Uint8Array(await file.arrayBuffer());
  const headers = { "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream", "Cache-Control": "public, max-age=31536000, immutable" };
  const signed = await aws.sign(r2ObjectUrl(c, key), { method: "PUT", headers, body: bytes });
  const res = await fetch(signed.url, { method: "PUT", headers: signed.headers, body: bytes });
  if (!res.ok) throw new Error(`R2 upload failed for ${key} (${res.status})`);
  return { publicUrl: r2Url(c.publicBase, key), path: `r2:${key}` };
}

/** The public link for a saved path (so the server never trusts a URL sent by the browser). */
export function publicUrlFor(path: string): string | null {
  const p = providerOf(path);
  if (p === "images") {
    const c = imagesConfig();
    return c && /^cfimg:[0-9a-f-]{20,64}$/i.test(path) ? imageUrl(c.hash, path.slice(6)) : null;
  }
  if (p === "r2") {
    const c = r2Config();
    return c ? r2Url(c.publicBase, path.slice(3)) : null;
  }
  return db().storage.from("media").getPublicUrl(path).data.publicUrl;
}
