// business.watchat.pro (any "business." host) is served by the /business routes.

export function isBusinessHost(host: string | null): boolean {
  return Boolean(host && /^business\./i.test(host));
}

/** Path on the business host → app route ("/" → "/business", "/en" → "/business/en"). */
export function businessPath(pathname: string): string {
  if (pathname === "/" || pathname === "") return "/business";
  if (pathname === "/business" || pathname.startsWith("/business/")) return pathname;
  return `/business${pathname}`;
}
