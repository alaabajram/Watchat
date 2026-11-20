// business.watchat.pro — partner landing page (producers, OTTs, telcos, white-label).
// The markup comes from the design canvas (./content.ts): static and written by us, never user input.

import { businessHtml } from "./content";
import { env } from "@/lib/env";

/** Where "talk to partnerships" and "support" go: BUSINESS_CONTACT_EMAIL if set, else the Watchat WhatsApp chat. */
function contactHref(): string {
  const email = process.env.BUSINESS_CONTACT_EMAIL;
  if (email && /^[^\s@<>"]+@[^\s@<>"]+$/.test(email)) return `mailto:${email}`;
  return env.waDisplayNumber ? `https://wa.me/${env.waDisplayNumber}` : "https://watchat.pro";
}

export function BusinessPage({ locale }: { locale: "ar" | "en" }) {
  const href = contactHref();
  const html = businessHtml[locale].replaceAll("__PARTNERS__", href).replaceAll("__SUPPORT__", href);
  return <div className="wc-biz" lang={locale} dangerouslySetInnerHTML={{ __html: html }} />;
}
