"use client";

import { createStoryUpload, storyFileUrl } from "@/app/admin/story-actions";
import { sendUpload } from "@/lib/storage/send";
import { STORY_UPLOADS, type StoryMedia, type StoryMediaType } from "@/lib/story/types";

/** Upload one scene file (picture, clip or sound) for a series; checked here and again on the server. */
export async function uploadStoryFile(seriesId: string, file: File, want: StoryMediaType, onProgress?: (pct: number) => void): Promise<StoryMedia> {
  const mime = file.type || (/\.m4a$/i.test(file.name) ? "audio/mp4" : /\.mp3$/i.test(file.name) ? "audio/mpeg" : "");
  const type = STORY_UPLOADS[mime];
  if (!type || type.type !== want) {
    throw new Error(want === "image" ? "Pictures: JPG, PNG or WebP." : want === "video" ? "Clips: MP4." : "Sound: MP3 or M4A.");
  }
  if (file.size > type.maxMb * 1048576) throw new Error(`${file.name} is ${(file.size / 1048576).toFixed(1)} MB; the limit is ${type.maxMb} MB.`);
  const target = await createStoryUpload(seriesId, mime, file.size);
  await sendUpload(target, new File([file], file.name, { type: mime }), onProgress);
  const url = await storyFileUrl(seriesId, target.path);
  return { path: target.path, url, type: want, name: file.name.replace(/\.[^.]+$/, "").slice(0, 80) };
}
