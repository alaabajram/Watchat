// The site's sign-in cookie lives on one hostname (the site address from Brand & site). Personal links
// opened on any other hostname are sent to the same path on the site address before signing in.

/** The canonical URL for this request, or null when the request is already on the site address. */
export function canonicalRedirect(url: URL, siteAddress: string): string | null {
  let site: URL;
  try {
    site = new URL(siteAddress);
  } catch {
    return null;
  }
  if (url.host.toLowerCase() === site.host.toLowerCase()) return null;
  // Never bounce local development or Vercel preview deployments (their links point at themselves).
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(url.host)) return null;
  if (/-git-|-[a-z0-9]{9}-[a-z0-9-]+\.vercel\.app$/i.test(url.host)) return null;
  return `${site.origin}${url.pathname}${url.search}`;
}
