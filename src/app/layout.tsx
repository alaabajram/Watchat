import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./brand.css";

export const metadata: Metadata = {
  title: "Watchat · واتشات",
  description: "Real drama, in the chat · دراما حقيقية في الشات",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b0b0f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Arabic, right-to-left by default. Pages for English viewers set dir="ltr" on their own wrapper.
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
