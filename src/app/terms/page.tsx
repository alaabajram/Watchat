// Written and published in Admin → Settings → Brand & site.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SitePageView } from "@/components/site/SitePageView";
import { PAGE_LABELS } from "@/lib/site/brand";
import { getPublishedPage } from "@/lib/site/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `${PAGE_LABELS.terms.en} · ${PAGE_LABELS.terms.ar}` };

export default async function Page() {
  const page = await getPublishedPage("terms");
  if (!page) notFound();
  return <SitePageView page={page} />;
}
