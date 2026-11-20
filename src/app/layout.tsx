import type { Metadata, Viewport } from "next";
import { brandCss } from "@/lib/site/brand";
import { getSiteSafe } from "@/lib/site/store";
import "./globals.css";
import "./brand.css";

// Brand & site settings (name, icon, colours) are read from the database; refreshed at most every minute.
export const revalidate = 60;

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSiteSafe();
  return {
    title: `${site.nameEn} · ${site.nameAr}`,
    description: "Real drama, in the chat · دراما حقيقية في الشات",
    robots: { index: false, follow: false },
    icons: { icon: site.icon, apple: site.icon },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f4f2ee",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const site = await getSiteSafe();
  // Arabic, right-to-left by default. Pages for English viewers set dir="ltr" on their own wrapper.
  return (
    <html lang="ar" dir="rtl">
      <head>
        {/* Brand colours from Admin → Brand & site (hex values validated on save and here). */}
        <style>{brandCss(site)}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
