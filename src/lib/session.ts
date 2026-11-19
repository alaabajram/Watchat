// Web sessions: a signed link is swapped for an HttpOnly cookie on first open.
// Max 3 active devices per viewer; a 4th sign-in revokes the oldest.

import { cookies } from "next/headers";
import { randomToken, sha256Hex } from "./crypto";
import { db } from "./supabase";

export const SESSION_COOKIE = "wc_session";
export const SESSION_MAX_AGE_S = 90 * 24 * 60 * 60;
export const MAX_DEVICES = 3;

export async function createSession(
  viewerId: string,
  meta: { userAgent?: string | null; ip?: string | null },
): Promise<string> {
  const token = randomToken(32);
  const { error } = await db()
    .from("sessions")
    .insert({ viewer_id: viewerId, token_hash: sha256Hex(token), user_agent: meta.userAgent ?? null, ip: meta.ip ?? null });
  if (error) throw new Error(`createSession failed: ${error.message}`);

  // Keep only the newest MAX_DEVICES sessions active.
  const { data: active } = await db()
    .from("sessions")
    .select("id")
    .eq("viewer_id", viewerId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  const stale = (active ?? []).slice(MAX_DEVICES).map((s) => s.id as string);
  if (stale.length) {
    await db().from("sessions").update({ revoked_at: new Date().toISOString() }).in("id", stale);
  }
  return token;
}

export type SessionViewer = { id: string; phoneHmac: string; uiLocale: "ar" | "en"; language: string | null };

/** The signed-in viewer for this request, or null. */
export async function getSessionViewer(): Promise<SessionViewer | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const { data } = await db()
    .from("sessions")
    .select("id, viewers!inner(id, phone_hmac, ui_locale, language)")
    .eq("token_hash", sha256Hex(token))
    .is("revoked_at", null)
    .maybeSingle();
  if (!data) return null;
  const v = (data as unknown as { viewers: { id: string; phone_hmac: string; ui_locale: "ar" | "en"; language: string | null } })
    .viewers;
  return { id: v.id, phoneHmac: v.phone_hmac, uiLocale: v.ui_locale, language: v.language };
}
