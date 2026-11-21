"use client";

import { createAssetUpload, registerAsset } from "@/app/admin/flow-actions";
import type { Asset } from "@/lib/flows/store";
import { sendUpload } from "@/lib/storage/send";

const LIMITS: Record<string, number> = { "image/jpeg": 5, "image/png": 5, "video/mp4": 16 };
export const ACCEPT = "image/jpeg,image/png,video/mp4";

/** Upload a file to the series library (checked against WhatsApp's limits first). */
export async function uploadAsset(seriesId: string, file: File): Promise<Asset> {
  const maxMb = LIMITS[file.type];
  if (!maxMb) throw new Error("WhatsApp accepts JPG/PNG images and MP4 videos.");
  if (file.size > maxMb * 1048576) {
    throw new Error(
      file.type === "video/mp4"
        ? `Video is ${(file.size / 1048576).toFixed(1)} MB; WhatsApp allows 16 MB. Export 540×960, H.264, ~700 kbps.`
        : `Image is ${(file.size / 1048576).toFixed(1)} MB; WhatsApp allows 5 MB.`,
    );
  }
  const target = await createAssetUpload(seriesId, file.type, file.size);
  await sendUpload(target, file);
  return registerAsset(seriesId, { path: target.path, name: file.name.replace(/\.[^.]+$/, ""), mime: file.type, size: file.size });
}

export const formatSize = (b: number | null) => (b == null ? "" : b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);
