"use client";

// Upload a file straight from the browser:
//   kind "stream"  → Cloudflare Stream (full web episode, adaptive HLS), saves the Stream id
//   other kinds    → Supabase Storage "media" bucket (chat clips, posters, subtitles), saves the public URL
// WhatsApp rejects videos over 16 MB, so chat clips are checked before uploading.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendUpload } from "@/lib/storage/send";
import { createMediaUpload, createStreamUpload, setMediaField } from "@/app/admin/content-actions";

type Props = {
  kind: "stream" | "clip" | "poster" | "subtitle";
  seriesCode: string;
  target: "episode" | "series";
  id: string;
  field: string;
  label: string;
};

const ACCEPT = { stream: "video/*", clip: "video/mp4", poster: "image/jpeg,image/png,image/webp", subtitle: ".vtt,text/vtt" };
const WA_MAX = 16 * 1024 * 1024;

export function MediaUpload(p: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);

  async function onFile(file: File) {
    try {
      if (p.kind === "clip" && file.size > WA_MAX) {
        setStatus(`Too big for WhatsApp (${(file.size / 1048576).toFixed(1)} MB). Export under 16 MB: 540×960, H.264, ~700 kbps.`);
        return;
      }
      setStatus("Uploading…");
      if (p.kind === "stream") {
        const { uploadUrl, uid } = await createStreamUpload(`${p.seriesCode} ${p.label}`);
        const body = new FormData();
        body.append("file", file);
        const res = await fetch(uploadUrl, { method: "POST", body });
        if (!res.ok) throw new Error(`Stream upload failed (${res.status})`);
        await setMediaField(p.target, p.id, p.field, uid);
      } else {
        const ext = (file.name.split(".").pop() ?? "").toLowerCase().replace("jpeg", "jpg");
        const target = await createMediaUpload(p.kind, p.seriesCode, ext);
        await sendUpload(target, file, (pct) => setStatus(`Uploading… ${pct}%`));
        await setMediaField(p.target, p.id, p.field, target.publicUrl);
      }
      setStatus("Saved ✓");
      router.refresh();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Upload failed");
    }
  }

  return (
    <span className="row" style={{ gap: 6 }}>
      <label className="inline" style={{ cursor: "pointer" }}>
        <span className="abtn secondary" style={{ padding: "4px 10px" }}>
          ⬆ {p.label}
        </span>
        <input
          type="file"
          accept={ACCEPT[p.kind]}
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
            e.target.value = "";
          }}
        />
      </label>
      {status && <span className="muted">{status}</span>}
    </span>
  );
}
