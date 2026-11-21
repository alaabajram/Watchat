import type { MetadataRoute } from "next";
import { getSiteSafe } from "@/lib/site/store";

// The home screen app: opens on the assistant, full screen, with the Watchat emblem.
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const site = await getSiteSafe();
  return {
    id: "/assistant",
    name: `${site.nameEn} · ${site.nameAr}`,
    short_name: site.nameEn,
    description: "مسلسلات قصيرة · Micro-dramas",
    start_url: "/assistant?source=homescreen",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    dir: "rtl",
    lang: "ar",
    background_color: "#f4f2ee",
    theme_color: "#f4f2ee",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
