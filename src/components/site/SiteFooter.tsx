// Small footer with the label's public pages and support contact (from Admin → Brand & site).

import { PAGE_LABELS } from "@/lib/site/brand";
import { getPublishedPage, getSiteSafe } from "@/lib/site/store";

export async function SiteFooter({ locale = "ar" }: { locale?: "ar" | "en" }) {
  const [site, terms, about] = await Promise.all([getSiteSafe(), getPublishedPage("terms"), getPublishedPage("about")]);
  const links = [
    about && { href: "/about", label: PAGE_LABELS.about[locale] },
    terms && { href: "/terms", label: PAGE_LABELS.terms[locale] },
    { href: "/privacy", label: PAGE_LABELS.privacy[locale] },
  ].filter(Boolean) as { href: string; label: string }[];
  return (
    <footer dir={locale === "en" ? "ltr" : "rtl"} style={{ padding: "28px 16px 40px", fontSize: 13, opacity: 0.75, display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "center" }}>
      {links.map((l) => (
        <a key={l.href} href={l.href} style={{ color: "inherit" }}>
          {l.label}
        </a>
      ))}
      {site.supportEmail && (
        <a href={`mailto:${site.supportEmail}`} style={{ color: "inherit" }}>
          {site.supportEmail}
        </a>
      )}
    </footer>
  );
}
