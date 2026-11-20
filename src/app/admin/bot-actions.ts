"use server";

import { audit, requireAdmin } from "@/lib/admin/auth";
import { done } from "@/lib/admin/forms";
import { COPY, SHARED_KEYS } from "@/lib/bot/copy";
import { env } from "@/lib/env";
import { db } from "@/lib/supabase";
import { getBusinessProfile, setProfileWebsites, websitesWithAccount } from "@/lib/whatsapp/profile";

/** Save the shared replies (same for every series). Empty field = use the default. Flow texts live on flow cards. */
export async function saveBotMessagesAction(fd: FormData) {
  const admin = await requireAdmin("bot");
  const back = "/admin/bot";

  const upserts: { tenant_id: string; series_id: string | null; key: string; lang: string; body: string; updated_by: string; updated_at: string }[] = [];
  const clears: { key: string; lang: string }[] = [];
  for (const key of SHARED_KEYS) {
    for (const lang of ["ar", "en"] as const) {
      const raw = String(fd.get(`${key}.${lang}`) ?? "").trim();
      const max = COPY[key].kind === "button" ? 20 : 1000;
      if (Array.from(raw).length > max) done(back, `"${COPY[key].label}" (${lang}) is longer than ${max} characters.`, "err");
      if (raw && raw !== COPY[key][lang]) {
        upserts.push({ tenant_id: admin.tenantId, series_id: null, key, lang, body: raw, updated_by: admin.id, updated_at: new Date().toISOString() });
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
    await db().from("bot_messages").delete().eq("tenant_id", admin.tenantId).eq("key", c.key).eq("lang", c.lang).is("series_id", null);
  }
  await audit(admin, "bot_messages.saved", "shared_replies", null, { overrides: upserts.length });
  done(back, `Saved. ${upserts.length} custom replies in use.`);
}

/** Put the permanent "My account" link (watchat.pro/me) on the WhatsApp business profile. */
export async function setAccountLinkOnProfileAction() {
  const admin = await requireAdmin("bot");
  const back = "/admin/bot";
  const accountUrl = `${env.appUrl}/me`;
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
