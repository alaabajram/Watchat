"use client";

// The series' media library: chat images and video cuts. Shows where each file is used;
// files in use can't be deleted. "Use on card" attaches a file to the selected card.

import { useState } from "react";
import { deleteAsset, renameAsset } from "@/app/admin/flow-actions";
import type { Asset } from "@/lib/flows/store";
import type { FlowGraph } from "@/lib/flows/types";
import { ACCEPT, formatSize, uploadAsset } from "./upload";

type Props = {
  seriesId: string;
  assets: Asset[];
  setAssets: (a: Asset[]) => void;
  graph: FlowGraph;
  publishedGraph: FlowGraph | null;
  canAttach: boolean;
  onAttach: (a: Asset) => void;
  onShowCard: (nodeId: string) => void;
};

function uses(g: FlowGraph | null, assetId: string): string[] {
  return (g?.nodes ?? []).filter((n) => "media" in n.data && n.data.media && "assetId" in n.data.media && n.data.media.assetId === assetId).map((n) => n.id);
}

export function MediaLibrary(p: Props) {
  const [status, setStatus] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "image" | "video">("all");

  async function onFiles(files: FileList) {
    let added = [...p.assets];
    for (const file of Array.from(files)) {
      try {
        setStatus(`Uploading ${file.name}…`);
        const a = await uploadAsset(p.seriesId, file);
        added = [a, ...added];
        p.setAssets(added);
        setStatus(`Added ${a.name} ✓`);
      } catch (e) {
        setStatus(e instanceof Error ? e.message : "Upload failed");
        return;
      }
    }
  }

  const list = p.assets.filter((a) => filter === "all" || a.kind === filter);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label
        style={{ border: "2px dashed #cbd5e1", borderRadius: 8, padding: 12, textAlign: "center", cursor: "pointer", background: "#f8fafc" }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files.length) void onFiles(e.dataTransfer.files);
        }}
      >
        <strong>⬆ Upload images & video cuts</strong>
        <div className="muted" style={{ fontSize: 12 }}>
          Drop files or click. JPG/PNG ≤ 5 MB · MP4 ≤ 16 MB (540×960, H.264)
        </div>
        <input type="file" accept={ACCEPT} multiple style={{ display: "none" }} onChange={(e) => e.target.files && void onFiles(e.target.files)} />
      </label>
      {status && <div className="muted" style={{ fontSize: 12 }}>{status}</div>}
      <div style={{ display: "flex", gap: 4 }}>
        {(["all", "image", "video"] as const).map((f) => (
          <button key={f} type="button" className={filter === f ? "" : "secondary"} style={{ padding: "2px 8px", fontSize: 12 }} onClick={() => setFilter(f)}>
            {f === "all" ? "All" : f === "image" ? "Images" : "Videos"}
          </button>
        ))}
      </div>
      {list.length === 0 && <p className="muted" style={{ fontSize: 12 }}>No files yet for this series.</p>}
      {list.map((a) => {
        const draftUses = uses(p.graph, a.id);
        const live = uses(p.publishedGraph, a.id).length > 0;
        return (
          <div key={a.id} style={{ border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden", background: "#fff" }}>
            {a.kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.url} alt="" style={{ width: "100%", height: 110, objectFit: "cover", display: "block" }} />
            ) : (
              <video src={a.url} muted playsInline preload="metadata" controls style={{ width: "100%", height: 140, background: "#000", display: "block" }} />
            )}
            <div style={{ padding: 6, fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
              <input
                defaultValue={a.name}
                onBlur={(e) => {
                  if (e.target.value !== a.name) {
                    void renameAsset(a.id, e.target.value);
                    p.setAssets(p.assets.map((x) => (x.id === a.id ? { ...x, name: e.target.value } : x)));
                  }
                }}
                style={{ fontSize: 12, padding: 2 }}
              />
              <span className="muted">
                {a.kind === "image" ? "Image" : "Video"} · {formatSize(a.sizeBytes)}
              </span>
              <span>
                {draftUses.length ? (
                  <>
                    Used on{" "}
                    {draftUses.map((id, i) => (
                      <a key={id} href="#" onClick={(e) => (e.preventDefault(), p.onShowCard(id))}>
                        card {i + 1}
                        {i < draftUses.length - 1 ? ", " : ""}
                      </a>
                    ))}
                  </>
                ) : (
                  <span className="muted">Not used yet</span>
                )}
                {live && " · live"}
              </span>
              <div style={{ display: "flex", gap: 4 }}>
                {p.canAttach && (
                  <button type="button" style={{ padding: "2px 8px", fontSize: 12 }} onClick={() => p.onAttach(a)}>
                    Use on selected card
                  </button>
                )}
                <button
                  type="button"
                  className="secondary"
                  style={{ padding: "2px 8px", fontSize: 12 }}
                  onClick={async () => {
                    const r = await deleteAsset(p.seriesId, a.id, p.graph);
                    if (!r.ok) setStatus(r.error ?? "Can't delete");
                    else p.setAssets(p.assets.filter((x) => x.id !== a.id));
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
