"use server";

// Admin → Brand & site → Storage: copy files still in Supabase to Cloudflare and point every link at the copy.

import { audit, requireAdmin } from "@/lib/admin/auth";
import { done } from "@/lib/admin/forms";
import { copyToCloudflare } from "@/lib/storage/cloudflare";
import { isImageExt, extOf, supabaseMediaPath } from "@/lib/storage/refs";
import { db } from "@/lib/supabase";

const LIKE = "%/storage/v1/object/public/media/%";
const BATCH = 25;

/** Links still pointing at the Supabase "media" bucket, split into pictures and other files. */
export async function supabaseLinks(): Promise<{ images: string[]; files: string[] } | null> {
  const { data, error } = await db().rpc("media_url_hits", { p_like: LIKE });
  if (error) return null;
  const urls = [...new Set(((data ?? []) as { url: string }[]).map((r) => r.url).filter((u) => supabaseMediaPath(u)))];
  return { images: urls.filter((u) => isImageExt(extOf(u))), files: urls.filter((u) => !isImageExt(extOf(u))) };
}

export async function moveFilesToCloudflareAction(): Promise<void> {
  const admin = await requireAdmin("site");
  const links = await supabaseLinks();
  if (!links) done("/admin/site", "Apply the storage database update first.", "err");
  const todo = [...links.images, ...links.files];
  let moved = 0;
  let waiting = 0;
  const problems: string[] = [];
  for (const url of todo.slice(0, BATCH)) {
    const key = supabaseMediaPath(url)!;
    try {
      const copy = await copyToCloudflare(url, key);
      if (!copy) {
        waiting++;
        continue;
      }
      const { error } = await db().rpc("replace_media_url", { p_old: url, p_new: copy.publicUrl });
      if (error) throw new Error(error.message);
      await db().from("media_assets").update({ path: copy.path }).eq("url", copy.publicUrl);
      moved++;
    } catch (e) {
      problems.push(e instanceof Error ? e.message : String(e));
    }
  }
  await audit(admin, "storage.moved_to_cloudflare", "site", null, { moved, waiting, failed: problems.length });
  const left = todo.length - moved - waiting - problems.length;
  const parts = [`Moved ${moved} file${moved === 1 ? "" : "s"} to Cloudflare.`];
  if (left > 0) parts.push(`${left} more: press Move again.`);
  if (waiting) parts.push(`${waiting} video/other file${waiting === 1 ? "" : "s"} wait for R2 to be set up.`);
  if (problems.length) parts.push(`Problem: ${problems[0]}`);
  done("/admin/site", parts.join(" "), problems.length && !moved ? "err" : "ok");
}
