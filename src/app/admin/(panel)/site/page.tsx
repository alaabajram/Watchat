// Admin → Settings → Brand & site: everything a label needs without touching the hosting settings.

import { SitePagesEditor } from "@/components/admin/SitePagesEditor";
import { SiteSettingsForm } from "@/components/admin/SiteSettingsForm";
import { requireAdmin } from "@/lib/admin/auth";
import { DEFAULT_SITE } from "@/lib/site/brand";
import { defaultPages } from "@/lib/site/defaults";
import { getPages, getSite } from "@/lib/site/store";

export const dynamic = "force-dynamic";

function detected(): string | null {
  const explicit = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  return process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null;
}

export default async function SitePage() {
  const admin = await requireAdmin("site");
  const [site, pages] = await Promise.all([getSite(admin.tenantId), getPages(admin.tenantId)]);
  const custom = (v: string, d: string) => (v === d ? null : v);

  return (
    <>
      <h1>Brand &amp; site</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Your label&apos;s address, name, logos, colours, contacts and public pages. Changes apply to the viewer site, the bot&apos;s links and the admin,
        with nothing to set up on the hosting.
      </p>
      <SiteSettingsForm
        detectedUrl={detected()}
        initial={{
          appUrl: site.appUrl ?? "",
          nameAr: site.nameAr === DEFAULT_SITE.nameAr ? "" : site.nameAr,
          nameEn: site.nameEn === DEFAULT_SITE.nameEn ? "" : site.nameEn,
          logoOnLight: custom(site.logoOnLight, DEFAULT_SITE.logoOnLight),
          logoOnDark: custom(site.logoOnDark, DEFAULT_SITE.logoOnDark),
          icon: custom(site.icon, DEFAULT_SITE.icon),
          colorPrimary: site.colorPrimary,
          colorAccent: site.colorAccent,
          supportEmail: site.supportEmail ?? "",
          supportWhatsapp: site.supportWhatsapp ?? "",
          businessEmail: site.businessEmail ?? "",
        }}
      />
      <SitePagesEditor pages={pages} defaults={defaultPages(site.nameAr, site.nameEn, site.supportEmail)} />
    </>
  );
}
