// Browser side: send one file to the target a server action returned (Cloudflare Images, R2 or Supabase).

import { CONTENT_TYPES, extOf, type UploadTarget } from "./refs";

export async function sendUpload(target: UploadTarget, file: Blob, onProgress?: (pct: number) => void): Promise<void> {
  const body: Blob | FormData = (() => {
    if (target.provider === "r2") return file;
    const form = new FormData();
    if (target.provider === "images") form.append("file", file);
    else {
      form.append("cacheControl", "31536000");
      form.append("", file);
    }
    return form;
  })();
  const headers: Record<string, string> = {};
  if (target.provider === "supabase") headers["x-upsert"] = "false";
  if (target.provider === "r2") headers["Content-Type"] = file.type || CONTENT_TYPES[extOf(target.path)] || "application/octet-stream";

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(target.method, target.url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((100 * e.loaded) / e.total));
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () =>
      reject(new Error(target.provider === "r2" ? "Upload blocked: add this site to the R2 bucket's CORS policy." : "Upload failed (network)"));
    xhr.send(body);
  });
}
