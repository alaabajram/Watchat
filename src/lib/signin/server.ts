// Server side of the one sign-in page: which doors are open right now, finding or creating the viewer behind a
// verified phone number or email, and the session cookie (the same one a WhatsApp link or Telegram sets).

import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseDeps, phoneHmac } from "../bot/deps-supabase";
import { hmacHex } from "../crypto";
import { emailReady } from "../email";
import { env } from "../env";
import { onNewViewer } from "../economy/rewards";
import { trackEvent } from "../events";
import { clientIp } from "../security/rate-limit";
import { createSession, SESSION_COOKIE, SESSION_COOKIE_MAX_AGE_S } from "../session";
import { sessionCookieOptions } from "../session-cookie";
import { siteUrl } from "../site/store";
import { currentTenantId, db } from "../supabase";
import { botLink, visitorChannel } from "../telegram/channel";
import { doorsFor, emailAddressFor, whatsappWorking, type Door } from "./doors";
import { preludeReady } from "./prelude";

/** HMAC of an email ("email:" prefix, so it can never equal a phone number's). */
export const emailHmac = (email: string) => hmacHex(env.phoneHashSecret, `email:${email}`);

let waCache: { at: number; ok: boolean } | null = null;

/** Is the WhatsApp number sending? From the latest outgoing chat messages; cached for 5 minutes. */
export async function whatsappSending(): Promise<boolean> {
  if (!env.waDisplayNumber) return false;
  if (waCache && Date.now() - waCache.at < 5 * 60_000) return waCache.ok;
  const since = new Date(Date.now() - 3 * 86400_000).toISOString();
  const { data } = await db()
    .from("wa_messages")
    .select("status, error, viewers!inner(phone_e164)")
    .eq("direction", "out")
    .gte("created_at", since)
    .not("viewers.phone_e164", "like", "+tg:%")
    .order("created_at", { ascending: false })
    .limit(5);
  const ok = whatsappWorking(((data ?? []) as { status: string | null; error: string | null }[]).map((m) => ({ status: m.status, error: m.error })));
  waCache = { at: Date.now(), ok };
  return ok;
}

export type DoorSetup = {
  doors: Door[];
  /** wa.me link with the word that makes the bot send a sign-in link. */
  waHref: string | null;
  /** The Watchat bot (Telegram); inside Telegram the Mini App signs in by itself. */
  tgHref: string | null;
  /** The page they go to after signing in. */
  to: string;
};

/** Everything the sign-in page needs for this visitor. `waText`: the word sent in WhatsApp (ابدأ, حسابي, a code…). */
export async function doorSetup(o: { waText: string; to: string; tgStart?: string | null }): Promise<DoorSetup> {
  const [channel, wa, tgHref] = await Promise.all([visitorChannel(), whatsappSending(), botLink(o.tgStart ?? null)]);
  const waHref = wa && env.waDisplayNumber ? `https://wa.me/${env.waDisplayNumber}?text=${encodeURIComponent(o.waText)}` : null;
  const doors = doorsFor({
    whatsapp: Boolean(waHref),
    // Telegram visitors always get their door (inside Telegram it signs in without the bot link).
    telegram: Boolean(tgHref) || channel === "telegram",
    phone: preludeReady(),
    email: emailReady(),
    prefer: channel === "telegram" ? "telegram" : null,
  });
  return { doors, waHref, tgHref, to: o.to };
}

/** A safe in-site path to go to after signing in. */
export const safeNext = (to: unknown) => (typeof to === "string" && to.startsWith("/") && !to.startsWith("//") && !to.startsWith("/\\") ? to.slice(0, 300) : "/");

export class SignInRefused extends Error {}

/**
 * The viewer behind a verified phone number: the same account as their WhatsApp chats (same hash). A number
 * whose hash belongs to a Telegram account is refused (Telegram ids and phone numbers share one hash space).
 */
export async function viewerForPhone(e164: string, locale: "ar" | "en"): Promise<{ id: string; created: boolean }> {
  const digits = e164.replace(/\D/g, "");
  const tenantId = await currentTenantId();
  const { data: found } = await db().from("viewers").select("id, phone_e164").eq("tenant_id", tenantId).eq("phone_hmac", phoneHmac(digits)).maybeSingle();
  if (found) {
    if (String(found.phone_e164).startsWith("+tg:")) throw new SignInRefused("telegram_account");
    return { id: found.id, created: false };
  }
  const v = await createSupabaseDeps().upsertViewer({ id: `phone:${digits}`, from: digits, timestamp: Math.floor(Date.now() / 1000), kind: "text", text: "" });
  // Signing in on the web isn't a WhatsApp message: no 24-hour chat window opens.
  await db().from("viewers").update({ last_inbound_at: null, ...(locale === "en" ? { ui_locale: "en" } : {}) }).eq("id", v.id);
  await trackEvent({ viewerHmac: phoneHmac(digits), name: "web_signup", props: { via: "phone" } });
  return { id: v.id, created: true };
}

/** The viewer behind a verified email: found by its hash, or a new email-only viewer ("+em:<id>", welcome Ping). */
export async function viewerForEmail(hmac: string, locale: "ar" | "en"): Promise<{ id: string; created: boolean }> {
  const tenantId = await currentTenantId();
  const { data: found } = await db().from("viewers").select("id").eq("tenant_id", tenantId).eq("phone_hmac", hmac).maybeSingle();
  if (found) return { id: found.id, created: false };
  const { data: created, error } = await db()
    .from("viewers")
    .upsert({ tenant_id: tenantId, phone_e164: `+${emailAddressFor(hmac)}`, phone_hmac: hmac, ui_locale: locale }, { onConflict: "tenant_id,phone_hmac" })
    .select("id")
    .single();
  if (error || !created) throw new Error(`email viewer failed: ${error?.message}`);
  await onNewViewer({ viewerId: created.id, tenantId, phoneHmac: hmac }).catch((e) => console.error("[rewards] new viewer", e));
  await trackEvent({ viewerHmac: hmac, name: "web_signup", props: { via: "email" } });
  return { id: created.id, created: true };
}

/** Answer with the session cookie set (first-party; framed Telegram sign-in has its own route). */
export async function withSession(req: NextRequest, viewerId: string, body: Record<string, unknown>): Promise<NextResponse> {
  const session = await createSession(viewerId, { userAgent: req.headers.get("user-agent"), ip: clientIp(req.headers) });
  const base = await siteUrl();
  const res = NextResponse.json(body);
  res.cookies.set(SESSION_COOKIE, session, { ...sessionCookieOptions(false, base.startsWith("https://")), maxAge: SESSION_COOKIE_MAX_AGE_S });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
