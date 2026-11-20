// The WhatsApp business profile (what viewers see when they tap "Watchat" at the top of the chat).
// We use it to keep a permanent "My account" link (watchat.pro/me) one tap away, costing no messages.

import { env } from "../env";

const base = () => `https://graph.facebook.com/${env.waGraphVersion}/${env.waPhoneNumberId}/whatsapp_business_profile`;
const auth = () => ({ Authorization: `Bearer ${env.waAccessToken}` });

export type BusinessProfile = { websites: string[]; about: string | null; description: string | null };

/** Meta allows at most 2 websites on a business profile. */
export const MAX_PROFILE_WEBSITES = 2;

export async function getBusinessProfile(): Promise<BusinessProfile> {
  const res = await fetch(`${base()}?fields=websites,about,description`, { headers: auth(), cache: "no-store" });
  const json = (await res.json().catch(() => null)) as { data?: { websites?: string[]; about?: string; description?: string }[]; error?: { message?: string } } | null;
  if (!res.ok) throw new Error(json?.error?.message ?? `Meta returned ${res.status}`);
  const p = json?.data?.[0] ?? {};
  return { websites: p.websites ?? [], about: p.about ?? null, description: p.description ?? null };
}

/** Put the account link first, keeping one other existing website if there's room. */
export function websitesWithAccount(current: string[], accountUrl: string): string[] {
  const norm = (u: string) => u.replace(/\/+$/, "").toLowerCase();
  const others = current.filter((u) => norm(u) !== norm(accountUrl));
  return [accountUrl, ...others].slice(0, MAX_PROFILE_WEBSITES);
}

export async function setProfileWebsites(websites: string[]): Promise<void> {
  const res = await fetch(base(), {
    method: "POST",
    headers: { ...auth(), "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", websites: websites.slice(0, MAX_PROFILE_WEBSITES) }),
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(json?.error?.message ?? `Meta returned ${res.status}`);
  }
}
