"use server";

import { siteUrl } from "@/lib/site/store";
import { audit, requireAdmin } from "@/lib/admin/auth";
import { done } from "@/lib/admin/forms";
import { env } from "@/lib/env";
import { db } from "@/lib/supabase";
import { getBusinessProfile, setProfileWebsites, websitesWithAccount } from "@/lib/whatsapp/profile";

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
