"use server";

import { siteUrl } from "@/lib/site/store";
import { audit, requireAdmin } from "@/lib/admin/auth";
import { done } from "@/lib/admin/forms";
import { revalidatePath } from "next/cache";
import { COPY, SHARED_KEYS, type CopyKey } from "@/lib/bot/copy";
import { maxLength } from "@/lib/bot/shared-map";
import { env } from "@/lib/env";
import { db } from "@/lib/supabase";
import { getBusinessProfile, setProfileWebsites, websitesWithAccount } from "@/lib/whatsapp/profile";

type Lang = "ar" | "en";

/** Write the shared replies: a value equal to the default (or empty) clears the override. */
async function writeSharedReplies(tenantId: string, adminId: string, value: (key: CopyKey, lang: Lang) => string): Promise<{ error?: string; overrides: number }> {
  const upserts: { tenant_id: string; series_id: string | null; key: string; lang: string; body: string; updated_by: string; updated_at: string }[] = [];
  const clears: { key: string; lang: string }[] = [];
  for (const key of SHARED_KEYS) {
    for (const lang of ["ar", "en"] as const) {
      const raw = value(key, lang).trim();
      const max = maxLength(key);
      if (Array.from(raw).length > max) return { error: `"${COPY[key].label}" (${lang}) is longer than ${max} characters.`, overrides: 0 };
      if (raw && raw !== COPY[key][lang]) {
        upserts.push({ tenant_id: tenantId, series_id: null, key, lang, body: raw, updated_by: adminId, updated_at: new Date().toISOString() });
      } else {
        clears.push({ key, lang });
      }
    }
  }
  if (upserts.length) {
    const { error } = await db().from("bot_messages").upsert(upserts, { onConflict: "tenant_id,series_id,key,lang" });
    if (error) return { error: `Save failed: ${error.message}`, overrides: 0 };
  }
  for (const c of clears) {
    await db().from("bot_messages").delete().eq("tenant_id", tenantId).eq("key", c.key).eq("lang", c.lang).is("series_id", null);
  }
  return { overrides: upserts.length };
}

/** Save from the Shared replies canvas. `values` holds "key.lang" → text for every text the team kept custom. */
export async function saveSharedRepliesCanvas(values: Record<string, string>): Promise<{ ok: boolean; message: string }> {
  const admin = await requireAdmin("bot");
  const r = await writeSharedReplies(admin.tenantId, admin.id, (key, lang) => {
    const v = values[`${key}.${lang}`];
    return typeof v === "string" ? v : "";
  });
  if (r.error) return { ok: false, message: r.error };
  await audit(admin, "bot_messages.saved", "shared_replies", null, { overrides: r.overrides, from: "canvas" });
  revalidatePath("/admin/bot");
  return { ok: true, message: r.overrides ? `Saved · ${r.overrides} custom texts in use` : "Saved · all defaults" };
}

/** Put the permanent "My account" link (watchat.pro/me) on the WhatsApp business profile. */
export async function setAccountLinkOnProfileAction() {
  const admin = await requireAdmin("bot");
  const back = "/admin/bot";
  const accountUrl = `${await siteUrl()}/me`;
  try {
    const profile = await getBusinessProfile();
    const websites = websitesWithAccount(profile.websites, accountUrl);
    await setProfileWebsites(websites);
    await audit(admin, "wa_profile.websites_set", "whatsapp_profile", null, { websites });
  } catch (e) {
    done(back, `WhatsApp profile not updated: ${e instanceof Error ? e.message : "unknown error"}`, "err");
  }
  done(back, `Done. Viewers who tap “Watchat” at the top of the chat now see ${accountUrl}.`);
}
