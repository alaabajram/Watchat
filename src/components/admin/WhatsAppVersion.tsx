"use client";

// One episode: pick the video file and get its WhatsApp version (under 16 MB) made in this browser.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { compressForWhatsApp } from "./compress";
import { setMediaField, uploadToStorage } from "./uploads";

export function WhatsAppVersion({ episodeId, seriesCode, field = "wa_video_url_ar", label = "Make WhatsApp version" }: { episodeId: string; seriesCode: string; field?: "wa_video_url_ar" | "wa_video_url_en"; label?: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  return (
    <span className="row" style={{ gap: 6 }}>
      <label className="abtn secondary" style={{ padding: "4px 10px", cursor: "pointer" }}>
        🗜 {label}
        <input
          type="file"
          accept="video/*"
          style={{ display: "none" }}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            try {
              const blob = await compressForWhatsApp(f, (p) => setStatus(`${p.stage} ${p.pct}%`));
              setStatus("Uploading…");
              const url = await uploadToStorage("clip", seriesCode, blob, "mp4");
              await setMediaField("episode", episodeId, field, url);
              if (field === "wa_video_url_ar") await setMediaField("episode", episodeId, "wa_size_bytes", String(blob.size));
              setStatus(`Saved ✓ ${(blob.size / 1048576).toFixed(1)} MB`);
              router.refresh();
            } catch (err) {
              setStatus(err instanceof Error ? err.message : "Failed");
            }
          }}
        />
      </label>
      {status && <span className="muted" style={{ fontSize: 12 }}>{status}</span>}
    </span>
  );
}
