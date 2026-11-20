"use server";

import { audit, requireAdmin } from "@/lib/admin/auth";
import { done, uuid } from "@/lib/admin/forms";
import { COPY, COPY_KEYS } from "@/lib/bot/copy";
import { db } from "@/lib/supabase";

/** Save overrides for every bot text. Empty field = use the default. Series empty = all series. */
export async function saveBotMessagesAction(fd: FormData) {
  const admin = await requireAdmin("bot");
  const seriesId = uuid(fd, "series_id");
  const back = `/admin/bot${seriesId ? `?series=${seriesId}` : ""}`;

  const upserts: { tenant_id: string; series_id: string | null; key: string; lang: string; body: string; updated_by: string; updated_at: string }[] = [];
  const clears: { key: string; lang: string }[] = [];
  for (const key of COPY_KEYS) {
    for (const lang of ["ar", "en"] as const) {
      const raw = String(fd.get(`${key}.${lang}`) ?? "").trim();
      const max = COPY[key].kind === "button" ? 20 : 1000;
      if (Array.from(raw).length > max) done(back, `"${COPY[key].label}" (${lang}) is longer than ${max} characters.`, "err");
      if (raw && raw !== COPY[key][lang]) {
        upserts.push({ tenant_id: admin.tenantId, series_id: seriesId, key, lang, body: raw, updated_by: admin.id, updated_at: new Date().toISOString() });
      } else {
        clears.push({ key, lang });
      }
    }
  }

  if (upserts.length) {
    const { error } = await db().from("bot_messages").upsert(upserts, { onConflict: "tenant_id,series_id,key,lang" });
    if (error) done(back, `Save failed: ${error.message}`, "err");
  }
  for (const c of clears) {
    let q = db().from("bot_messages").delete().eq("tenant_id", admin.tenantId).eq("key", c.key).eq("lang", c.lang);
    q = seriesId ? q.eq("series_id", seriesId) : q.is("series_id", null);
    await q;
  }
  await audit(admin, "bot_messages.saved", "series", seriesId, { overrides: upserts.length });
  done(back, `Saved. ${upserts.length} custom texts in use.`);
}
