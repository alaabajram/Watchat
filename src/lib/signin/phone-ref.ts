// The phone number travels to the browser only sealed (AES-GCM with a server key): the sign-in page keeps
// "+97150 ••• 4567" to show and this sealed copy to ask for the next code, so a device never holds the number.

import { env } from "../env";
import { openSecret, sealSecret } from "../secret-box";
import { normalizePhone } from "./doors";

const key = () => `watchat-phone-ref:${env.phoneHashSecret}`;
const MAX_AGE_MS = 400 * 86400_000;

export const sealPhone = (e164: string) => sealSecret(`${e164}|${Date.now()}`, key());

/** The number inside a sealed reference, or null (tampered, from another server key, or older than 400 days). */
export function openPhone(ref: unknown): string | null {
  if (typeof ref !== "string" || ref.length > 400) return null;
  try {
    const [e164, at] = openSecret(ref, key()).split("|");
    if (!at || Date.now() - Number(at) > MAX_AGE_MS) return null;
    return normalizePhone(e164);
  } catch {
    return null;
  }
}
