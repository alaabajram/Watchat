// business.watchat.pro — partner landing page (producers, OTTs, telcos, white-label).
// The markup comes from the design canvas (./content.ts): static and written by us, never user input.

import { businessHtml } from "./content";
import { env } from "@/lib/env";
import { getSiteSafe } from "@/lib/site/store";

/** Where "talk to partnerships" and "support" go: the business email from Brand & site (or BUSINESS_CONTACT_EMAIL), else the WhatsApp chat. */
function contactHref(businessEmail: string | null): string {
  const email = businessEmail;
  if (email && /^[^\s@<>"]+@[^\s@<>"]+$/.test(email)) return `mailto:${email}`;
  return env.waDisplayNumber ? `https://wa.me/${env.waDisplayNumber}` : "https://watchat.pro";
}

export async function BusinessPage({ locale }: { locale: "ar" | "en" }) {
  const href = contactHref((await getSiteSafe()).businessEmail);
  const html = businessHtml[locale].replaceAll("__PARTNERS__", href).replaceAll("__SUPPORT__", href);
  return <div className="wc-biz" lang={locale} dangerouslySetInnerHTML={{ __html: html }} />;
}
