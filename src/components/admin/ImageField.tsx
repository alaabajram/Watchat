"use client";

// A picture box for plain admin forms: uploads straight to storage (Cloudflare Images when set up) and keeps
// the stored path in a hidden input named `name`, so the server action saves a path it can check, never a URL.

import { useState } from "react";
import { createPlayUpload } from "@/app/admin/play-actions";
import { sendUpload } from "@/lib/storage/send";

export function ImageField({ name, label, hint, path, url, ratio = "16 / 9" }: { name: string; label: string; hint?: string; path: string | null; url: string | null; ratio?: string }) {
  const [value, setValue] = useState(path ?? "");
  const [preview, setPreview] = useState(url);
  const [status, setStatus] = useState<string | null>(null);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 180 }}>
      <strong style={{ fontSize: 14 }}>{label}</strong>
      {hint ? <span className="muted" style={{ fontSize: 12 }}>{hint}</span> : null}
      <input type="hidden" name={name} value={value} />
      <div style={{ width: 200, aspectRatio: ratio, borderRadius: 12, overflow: "hidden", background: "#13101a", display: "grid", placeItems: "center", border: "1px solid var(--a-line, #ddd)" }}>
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <span className="muted" style={{ fontSize: 12 }}>No picture (emoji shows)</span>
        )}
      </div>
      <div className="row">
        <label className="abtn secondary" style={{ cursor: "pointer" }}>
          Upload
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            style={{ display: "none" }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              if (f.size > 8 * 1048576) {
                setStatus("Keep pictures under 8 MB.");
                return;
              }
              try {
                setStatus("Uploading…");
                const target = await createPlayUpload((f.name.split(".").pop() ?? "").toLowerCase());
                await sendUpload(target, f);
                setValue(target.path);
                setPreview(target.publicUrl);
                setStatus("Uploaded — save to apply.");
              } catch (err) {
                setStatus(err instanceof Error ? err.message : "Upload failed");
              }
            }}
          />
        </label>
        {value ? (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setValue("");
              setPreview(null);
              setStatus("Removed — save to apply.");
            }}
          >
            Remove
          </button>
        ) : null}
      </div>
      {status ? <span className="muted" style={{ fontSize: 12 }}>{status}</span> : null}
    </div>
  );
}
