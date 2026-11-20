import type { NextConfig } from "next";

// Security headers for every response.
// CSP note: Next.js needs inline scripts for hydration; move to nonce-based CSP before launch.
const csp = [
  "default-src 'self'",
  // React's dev tooling needs eval; production never gets it.
  // wasm-unsafe-eval: lets the admin's in-browser video converter (ffmpeg.wasm) run; it doesn't allow eval().
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""} https://embed.cloudflarestream.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  // Admin uploads go straight from the browser to Supabase Storage and Cloudflare Stream.
  "connect-src 'self' https://*.supabase.co https://upload.cloudflarestream.com https://upload.videodelivery.net https://*.cloudflarestream.com https://*.videodelivery.net",
  "frame-src https://*.cloudflarestream.com https://iframe.videodelivery.net",
  "frame-ancestors 'none'",
  "form-action 'self' https://*.tap.company",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self \"https://*.tap.company\")" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "*.cloudflarestream.com" },
    ],
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Keep the admin and personal links out of search engines and caches.
      { source: "/admin/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Cache-Control", value: "no-store" }] },
      { source: "/w/:path*", headers: [{ key: "Cache-Control", value: "no-store" }, { key: "Referrer-Policy", value: "no-referrer" }] },
    ];
  },
};

export default nextConfig;
