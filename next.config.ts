import type { NextConfig } from "next";

// Security headers for every response.
// CSP note: Next.js needs inline scripts for hydration; move to nonce-based CSP before launch.
const cspWith = (frameAncestors: string) => [
  "default-src 'self'",
  // React's dev tooling needs eval; production never gets it.
  // wasm-unsafe-eval: lets the admin's in-browser video converter (ffmpeg.wasm) run; it doesn't allow eval().
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""} https://embed.cloudflarestream.com https://telegram.org`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  // Admin uploads go straight from the browser to Cloudflare (Images, R2, Stream), or Supabase Storage before that is set up.
  "connect-src 'self' https://*.supabase.co https://upload.cloudflarestream.com https://upload.videodelivery.net https://*.cloudflarestream.com https://*.videodelivery.net https://upload.imagedelivery.net https://*.r2.cloudflarestorage.com",
  "frame-src https://*.cloudflarestream.com https://iframe.videodelivery.net",
  `frame-ancestors ${frameAncestors}`,
  "form-action 'self' https://*.tap.company",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");
// Telegram Web / Desktop show the Mini App in a frame on telegram.org; nobody else may frame the viewer site.
const csp = cspWith("'self' https://web.telegram.org https://*.telegram.org");

// The admin and business pages are never framed, not even by Telegram (same policy, framing refused).
const noFraming = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: cspWith("'none'") },
];

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self \"https://*.tap.company\")" },
];

/** R2 custom domain (e.g. media.watchat.pro) for next/image, read from R2_PUBLIC_URL at build time. */
function r2Host(): { protocol: "https"; hostname: string }[] {
  try {
    const host = new URL(process.env.R2_PUBLIC_URL ?? "").hostname;
    return host && !host.endsWith(".r2.dev") ? [{ protocol: "https", hostname: host }] : [];
  } catch {
    return [];
  }
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "*.cloudflarestream.com" },
      { protocol: "https", hostname: "imagedelivery.net" },
      { protocol: "https", hostname: "*.r2.dev" },
      ...r2Host(),
    ],
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Keep the admin and personal links out of search engines and caches.
      { source: "/admin/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Cache-Control", value: "no-store" }, ...noFraming] },
      { source: "/business/:path*", headers: noFraming },
      { source: "/w/:path*", headers: [{ key: "Cache-Control", value: "no-store" }, { key: "Referrer-Policy", value: "no-referrer" }] },
      // The service worker must always be fresh so alert fixes reach phones right away.
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }, { key: "Service-Worker-Allowed", value: "/" }] },
    ];
  },
};

export default nextConfig;
