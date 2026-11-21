"use server";

// Admin → Settings → Brand & site: the label's address, names, logos, colours, contacts and public pages.

import { audit, requireAdmin } from "@/lib/admin/auth";
import { randomToken } from "@/lib/crypto";
import { cleanSiteUrl, HEX, PAGE_SLUGS, type PageSlug } from "@/lib/site/brand";
import { clearSiteCache } from "@/lib/site/store";
import { db } from "@/lib/supabase";
import { uploadTarget } from "@/lib/storage/cloudflare";
import type { UploadTarget } from "@/lib/storage/refs";

export type SiteForm = {
  appUrl: string;
  nameAr: string;
  nameEn: string;
  logoOnLight: string | null;
  logoOnDark: string | null;
  icon: string | null;
  colorPrimary: string;
  colorAccent: string;
  supportEmail: string;
  supportWhatsapp: string;
  businessEmail: string;
};

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const text = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
/** Only our own uploads (Supabase storage, https) or the built-in brand files. */
const asset = (v: unknown) => {
  const s = text(v, 600);
  return !s ? null : /^https:\/\/[^\s"'<>]+$/.test(s) || /^\/brand\/[\w.-]+$/.test(s) ? s : undefined;
};

export async function saveSiteSettings(f: SiteForm): Promise<{ ok: boolean; message: string }> {
  const admin = await requireAdmin("site");
  const problems: string[] = [];
  const appUrlRaw = text(f.appUrl, 200);
  const appUrl = appUrlRaw ? cleanSiteUrl(appUrlRaw) : null;
  if (appUrlRaw && !appUrl) problems.push("Site address must be a full https address, like https://www.watchat.pro.");
  const colorPrimary = text(f.colorPrimary, 7);
  const colorAccent = text(f.colorAccent, 7);
  if (!HEX.test(colorPrimary) || !HEX.test(colorAccent)) problems.push("Colours must look like #31e5a0.");
  const supportEmail = text(f.supportEmail, 200);
  const businessEmail = text(f.businessEmail, 200);
  if (supportEmail && !EMAIL.test(supportEmail)) problems.push("Support email doesn't look right.");
  if (businessEmail && !EMAIL.test(businessEmail)) problems.push("Business email doesn't look right.");
  const supportWhatsapp = text(f.supportWhatsapp, 30).replace(/\D/g, "");
  if (supportWhatsapp && (supportWhatsapp.length < 8 || supportWhatsapp.length > 15)) problems.push("Support WhatsApp: the number with country code, e.g. 971500000000.");
  const logos = { logo_on_light_url: asset(f.logoOnLight), logo_on_dark_url: asset(f.logoOnDark), icon_url: asset(f.icon) };
  if (Object.values(logos).includes(undefined)) problems.push("A logo link isn't valid. Upload the image again.");
  if (problems.length) return { ok: false, message: problems.join(" ") };

  const { error } = await db()
    .from("site_settings")
    .upsert({
      tenant_id: admin.tenantId,
      app_url: appUrl,
      name_ar: text(f.nameAr, 60) || null,
      name_en: text(f.nameEn, 60) || null,
      ...logos,
      color_primary: colorPrimary.toLowerCase(),
      color_accent: colorAccent.toLowerCase(),
      support_email: supportEmail || null,
      support_whatsapp: supportWhatsapp || null,
      business_email: businessEmail || null,
      updated_by: admin.id,
      updated_at: new Date().toISOString(),
    });
  if (error) return { ok: false, message: `Not saved: ${error.message}` };
  clearSiteCache(admin.tenantId);
  await audit(admin, "site_settings.saved", "site_settings", null, { appUrl });
  return { ok: true, message: "Saved. Other servers pick up the change within a minute." };
}

export async function savePage(slug: PageSlug, p: { titleAr: string; titleEn: string; bodyAr: string; bodyEn: string; published: boolean }): Promise<{ ok: boolean; message: string }> {
  const admin = await requireAdmin("site");
  if (!(PAGE_SLUGS as readonly string[]).includes(slug)) return { ok: false, message: "Unknown page." };
  const row = {
    tenant_id: admin.tenantId,
    slug,
    title_ar: text(p.titleAr, 120),
    title_en: text(p.titleEn, 120),
    body_ar: String(p.bodyAr ?? "").slice(0, 60_000),
    body_en: String(p.bodyEn ?? "").slice(0, 60_000),
    published: Boolean(p.published),
    updated_by: admin.id,
    updated_at: new Date().toISOString(),
  };
  if (row.published && !row.body_ar.trim() && !row.body_en.trim()) return { ok: false, message: "Write the page before publishing it." };
  const { error } = await db().from("site_pages").upsert(row);
  if (error) return { ok: false, message: `Not saved: ${error.message}` };
  await audit(admin, "site_page.saved", "site_pages", slug, { published: row.published });
  return { ok: true, message: row.published ? "Saved and live." : "Saved as a draft (not shown on the site)." };
}

const IMAGE_EXT = ["png", "jpg", "jpeg", "webp"] as const;

/** Signed URL to upload a logo straight from the browser to the public "media" bucket. */
export async function createSiteUpload(kind: "logo-light" | "logo-dark" | "icon", ext: string): Promise<UploadTarget> {
  const admin = await requireAdmin("site");
  const e = ext.toLowerCase();
  if (!(IMAGE_EXT as readonly string[]).includes(e) || !["logo-light", "logo-dark", "icon"].includes(kind)) throw new Error("File type not allowed.");
  return uploadTarget(`site/${admin.tenantId}/${kind}-${Date.now()}-${randomToken(6)}.${e}`);
}
