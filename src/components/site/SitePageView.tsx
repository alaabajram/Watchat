// A public page (Terms, Privacy, About) written in Admin → Brand & site: Arabic first, then English.

import type { SitePage } from "@/lib/site/store";
import { PAGE_LABELS } from "@/lib/site/brand";
import { PageBody } from "./PageBody";
import { SiteFooter } from "./SiteFooter";

export function SitePageView({ page }: { page: SitePage }) {
  const updated = page.updatedAt ? new Date(page.updatedAt) : null;
  return (
    <main className="page">
      {page.bodyAr.trim() && (
        <section dir="rtl" lang="ar">
          <h1>{page.titleAr || PAGE_LABELS[page.slug].ar}</h1>
          {updated && <p className="muted">آخر تحديث: {updated.toLocaleDateString("ar-AE", { dateStyle: "long", timeZone: "Asia/Dubai" })}</p>}
          <PageBody text={page.bodyAr} />
        </section>
      )}
      {page.bodyAr.trim() && page.bodyEn.trim() && <hr style={{ margin: "40px 0", borderColor: "#333" }} />}
      {page.bodyEn.trim() && (
        <section dir="ltr" lang="en">
          <h1>{page.titleEn || PAGE_LABELS[page.slug].en}</h1>
          {updated && <p className="muted">Last updated: {updated.toLocaleDateString("en-GB", { dateStyle: "long", timeZone: "Asia/Dubai" })}</p>}
          <PageBody text={page.bodyEn} />
        </section>
      )}
      <SiteFooter />
    </main>
  );
}
