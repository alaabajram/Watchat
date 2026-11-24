// Copy one file from a script's media list (e.g. an OpenArt result) into Watchat's storage and put it on every
// draft scene with that picture name. Server only; callers check who's asking (Story builder, Studio connector).

import { randomToken } from "@/lib/crypto";
import { copyToCloudflare } from "@/lib/storage/cloudflare";
import { db } from "@/lib/supabase";
import { applyMedia, FETCH_MAX_MB, hostAllowed, mediaKindOf } from "./import";
import { sanitizeStory } from "./sanitize";

/** Hosts a media list may point at: OpenArt (and its subdomains), plus any in STORY_IMPORT_HOSTS. */
export const importHosts = () => ["openart.ai", ...(process.env.STORY_IMPORT_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean)];

export async function copyStoryMedia(series: { id: string; code: string }, ref: string, url: string, onlyEpisode?: string): Promise<{ scenes: number; type: "image" | "video" | "audio" }> {
  const key = ref.toLowerCase();
  if (!/^[a-z0-9_.-]{1,40}$/.test(key)) throw new Error("Bad picture name.");
  const hosts = importHosts();
  if (!hostAllowed(url, hosts)) {
    let host = url.slice(0, 40);
    try {
      host = new URL(url).hostname;
    } catch {
      /* keep the start of the text */
    }
    throw new Error(`${ref}: files from ${host} aren't allowed. Add it to STORY_IMPORT_HOSTS in Vercel if it's yours.`);
  }

  // Ask what the file is (and where it really lives) before copying it.
  let contentType = "";
  let size = 0;
  try {
    const head = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(15000) });
    if (head.ok) {
      if (!hostAllowed(head.url, hosts)) throw new Error(`${ref}: the address leads to another site.`);
      contentType = head.headers.get("content-type") ?? "";
      size = Number(head.headers.get("content-length") ?? 0);
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith(ref)) throw e;
  }
  const kind = mediaKindOf(url, contentType);
  if (!kind) throw new Error(`${ref}: only JPG, PNG, WebP pictures, MP4 clips and MP3, M4A or WAV sounds can be imported.`);
  const limit = FETCH_MAX_MB[kind.type];
  if (size > limit * 1048576) throw new Error(`${ref}: the file is over ${limit} MB.`);

  const copied = await copyToCloudflare(url, `${series.code}/story/${Date.now()}-${randomToken(6)}.${kind.ext}`);
  if (!copied) throw new Error(`Connect Cloudflare ${kind.type === "image" ? "Images" : "R2"} first (Admin → Brand & site → Storage).`);
  const media = { path: copied.path, url: copied.publicUrl, type: kind.type, name: key };

  let q = db().from("episodes").select("id, story_draft").eq("series_id", series.id);
  if (onlyEpisode) q = q.eq("id", onlyEpisode);
  const { data: eps } = await q;
  let scenes = 0;
  for (const ep of eps ?? []) {
    if (!ep.story_draft) continue;
    const r = applyMedia(sanitizeStory(ep.story_draft), key, media);
    if (!r.count) continue;
    scenes += r.count;
    await db().from("episodes").update({ story_draft: r.story }).eq("id", ep.id);
  }
  return { scenes, type: kind.type };
}
