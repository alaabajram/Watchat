// Cookie name and lifetime, importable from the proxy (which must not pull in the database client).
export const SESSION_COOKIE = "wc_session";
export const SESSION_MAX_AGE_S = 90 * 24 * 60 * 60;
/** The cookie itself lives longer (browser maximum) so a browser the viewer used before is still
 *  recognised when their own Watchat link is opened again after the session went idle. */
export const SESSION_COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60;

/**
 * Session cookie settings. Inside Telegram Web / Desktop the site runs in a frame on telegram.org, where a
 * SameSite=Lax cookie is never sent; there the cookie is SameSite=None + Partitioned (kept only for that frame).
 * Cross-site requests are still refused: every viewer API checks Origin (sameOrigin) and server actions do too.
 */
export function sessionCookieOptions(framed: boolean, secure: boolean) {
  return framed
    ? { httpOnly: true, secure: true, sameSite: "none" as const, partitioned: true, path: "/" }
    : { httpOnly: true, secure, sameSite: "lax" as const, path: "/" };
}

/** A page load inside someone else's frame (Telegram Web / Desktop). */
export const loadedInFrame = (headers: Headers) => headers.get("sec-fetch-dest") === "iframe";

