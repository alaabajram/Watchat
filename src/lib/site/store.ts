// Server side of Brand & site settings. Read on almost every request, so kept in memory for a minute
// (saving in the admin clears it straight away on that server).

import { env } from "../env";
import { currentTenantId, db } from "../supabase";
import { DEFAULT_SITE, type PageSlug, type SiteSettings } from "./brand";

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; site: SiteSettings; saved: boolean }>();

export async function getSite(tenantId?: string): Promise<SiteSettings & { saved: boolean }> {
  const id = tenantId ?? (await currentTenantId());
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return { ...hit.site, saved: hit.saved };
  const { data } = await db().from("site_settings").select("*").eq("tenant_id", id).maybeSingle();
  const site: SiteSettings = {
    appUrl: data?.app_url || null,
    nameAr: data?.name_ar || DEFAULT_SITE.nameAr,
    nameEn: data?.name_en || DEFAULT_SITE.nameEn,
    logoOnLight: data?.logo_on_light_url || DEFAULT_SITE.logoOnLight,
    logoOnDark: data?.logo_on_dark_url || DEFAULT_SITE.logoOnDark,
    icon: data?.icon_url || DEFAULT_SITE.icon,
    colorPrimary: data?.color_primary || DEFAULT_SITE.colorPrimary,
    colorAccent: data?.color_accent || DEFAULT_SITE.colorAccent,
    supportEmail: data?.support_email || process.env.SUPPORT_EMAIL || null,
    supportWhatsapp: data?.support_whatsapp || null,
    businessEmail: data?.business_email || process.env.BUSINESS_CONTACT_EMAIL || null,
  };
  cache.set(id, { at: Date.now(), site, saved: Boolean(data) });
  return { ...site, saved: Boolean(data) };
}

/** Best-effort read for layouts: defaults if the database can't be reached. */
export async function getSiteSafe(): Promise<SiteSettings> {
  try {
    return await getSite();
  } catch {
    return DEFAULT_SITE;
  }
}

export function clearSiteCache(tenantId: string) {
  cache.delete(tenantId);
}

/**
 * The site's public address for personal links, payments and templates: Brand & site setting first,
 * then APP_URL / Vercel's production domain.
 */
export async function siteUrl(): Promise<string> {
  try {
    const s = await getSite();
    if (s.appUrl) return s.appUrl;
  } catch {
    // fall through to the environment
  }
  return env.appUrl;
}

export type SitePage = { slug: PageSlug; titleAr: string; titleEn: string; bodyAr: string; bodyEn: string; published: boolean; updatedAt: string | null };

export async function getPages(tenantId: string): Promise<Record<PageSlug, SitePage>> {
  const { data } = await db().from("site_pages").select("*").eq("tenant_id", tenantId);
  const by = new Map((data ?? []).map((r) => [r.slug as PageSlug, r]));
  const page = (slug: PageSlug): SitePage => {
    const r = by.get(slug);
    return { slug, titleAr: r?.title_ar ?? "", titleEn: r?.title_en ?? "", bodyAr: r?.body_ar ?? "", bodyEn: r?.body_en ?? "", published: r?.published ?? false, updatedAt: r?.updated_at ?? null };
  };
  return { terms: page("terms"), privacy: page("privacy"), about: page("about") };
}

/** A published page for the public site, or null. */
export async function getPublishedPage(slug: PageSlug): Promise<SitePage | null> {
  try {
    const p = (await getPages(await currentTenantId()))[slug];
    return p.published && (p.bodyAr.trim() || p.bodyEn.trim()) ? p : null;
  } catch {
    return null;
  }
}
