// Silent sign-in: a personal WhatsApp link is swapped for an HttpOnly cookie on first open.
// The viewer stays signed in on that device (90 days, extended on each visit) with no form.
// Max 3 active devices per viewer; a 4th sign-in signs out the oldest.
// Spending money or coins needs a *trusted* session: a link opened within minutes of being sent,
// or a session confirmed by sending a code from the viewer's WhatsApp number.

import { cookies } from "next/headers";
import { randomToken, sha256Hex } from "./crypto";
import { db } from "./supabase";

export const SESSION_COOKIE = "wc_session";
export const SESSION_MAX_AGE_S = 90 * 24 * 60 * 60;
export const MAX_DEVICES = 3;
const TOUCH_EVERY_MS = 10 * 60 * 1000;

export async function createSession(
  viewerId: string,
  meta: { userAgent?: string | null; ip?: string | null; trusted?: boolean },
): Promise<string> {
  const token = randomToken(32);
  const { error } = await db()
    .from("sessions")
    .insert({
      viewer_id: viewerId,
      token_hash: sha256Hex(token),
      user_agent: meta.userAgent?.slice(0, 300) ?? null,
      ip: meta.ip ?? null,
      trusted_at: meta.trusted ? new Date().toISOString() : null,
    });
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

export type SessionViewer = {
  id: string;
  sessionId: string;
  phoneHmac: string;
  uiLocale: "ar" | "en";
  language: string | null;
  country: string | null;
  trusted: boolean;
};

/** The signed-in viewer for this request, or null. Also keeps "last seen" fresh for CRM segments. */
export async function getSessionViewer(): Promise<SessionViewer | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const { data } = await db()
    .from("sessions")
    .select("id, last_seen_at, trusted_at, viewers!inner(id, phone_hmac, ui_locale, language, country)")
    .eq("token_hash", sha256Hex(token))
    .is("revoked_at", null)
    .maybeSingle();
  if (!data) return null;

  const lastSeen = new Date(data.last_seen_at).getTime();
  if (Date.now() - lastSeen > SESSION_MAX_AGE_S * 1000) return null; // idle for 90 days

  const v = (data as unknown as {
    viewers: { id: string; phone_hmac: string; ui_locale: "ar" | "en"; language: string | null; country: string | null };
  }).viewers;

  if (Date.now() - lastSeen > TOUCH_EVERY_MS) {
    const now = new Date().toISOString();
    await Promise.all([
      db().from("sessions").update({ last_seen_at: now }).eq("id", data.id),
      db().from("viewers").update({ last_seen_at: now }).eq("id", v.id),
    ]);
  }

  return {
    id: v.id,
    sessionId: data.id,
    phoneHmac: v.phone_hmac,
    uiLocale: v.ui_locale,
    language: v.language,
    country: v.country,
    trusted: Boolean(data.trusted_at),
  };
}

export async function listDevices(viewerId: string) {
  const { data } = await db()
    .from("sessions")
    .select("id, user_agent, created_at, last_seen_at")
    .eq("viewer_id", viewerId)
    .is("revoked_at", null)
    .order("last_seen_at", { ascending: false });
  return data ?? [];
}

export async function revokeSessions(viewerId: string, keepSessionId?: string) {
  let query = db().from("sessions").update({ revoked_at: new Date().toISOString() }).eq("viewer_id", viewerId).is("revoked_at", null);
  if (keepSessionId) query = query.neq("id", keepSessionId);
  await query;
}

/** Short device label from a user agent, for the settings page. */
export function deviceLabel(userAgent: string | null): string {
  const ua = userAgent ?? "";
  const os = /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : /Mac OS/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "Device";
  const browser = /CriOS|Chrome/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : /Firefox/.test(ua) ? "Firefox" : "Browser";
  return `${os} · ${browser}`;
}
