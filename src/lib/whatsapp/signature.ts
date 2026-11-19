import { hmacHex, safeEqual } from "../crypto";

/**
 * Meta signs every webhook with the app secret: header `X-Hub-Signature-256: sha256=<hex>`
 * computed over the raw request body. Reject anything that doesn't match.
 */
export function isValidSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header || !header.startsWith("sha256=")) return false;
  const expected = `sha256=${hmacHex(appSecret, rawBody)}`;
  return safeEqual(expected, header);
}
