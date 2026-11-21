// Cookie name and lifetime, importable from the proxy (which must not pull in the database client).
export const SESSION_COOKIE = "wc_session";
export const SESSION_MAX_AGE_S = 90 * 24 * 60 * 60;
/** The cookie itself lives longer (browser maximum) so a browser the viewer used before is still
 *  recognised when their own Watchat link is opened again after the session went idle. */
export const SESSION_COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60;
