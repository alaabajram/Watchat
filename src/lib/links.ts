// Personal signed links: the bot sends watchat.pro/w/<token> in the viewer's own Watchat chat;
// opening it signs them in. Only the SHA-256 hash of the token is stored.
//
// A link only ever opens its OWNER's account on a browser we can tie to the owner (decideLinkOpen):
//   • signed in here as the owner → open the episode;
//   • signed in here to ANOTHER account (a forwarded link) → stay in that account, same episode on the web;
//   • this browser was the owner's before (session went idle) → sign the owner in again, silently;
//   • a brand-new browser opening the link for the FIRST time within 24 h of sending (FIRST_OPEN_MINUTES)
//     → sign the owner in (how a new viewer's first link from an ad works);
//   • anything else — a forwarded link on an unknown phone, a re-opened or expired link — → "Sign in with
//     WhatsApp": sending the pre-filled message proves the opener's own number and the bot replies with a
//     link to THEIR account. An unknown browser never gets the owner's account.
// To bring a friend, viewers use Share (the series' Watchat chat link), so the friend starts in WhatsApp.

import { siteUrl } from "./site/store";
import { randomToken, sha256Hex } from "./crypto";
import { env } from "./env";
import type { MsgRef } from "./ctr/ctr";
import { db } from "./supabase";

/** A personal link signs its owner in, as often as they open it, for this long (same as a session). */
export const LINK_TTL_DAYS = 90;
/** uses_left records whether the link has been opened yet: only its first open can sign in a new browser. */
export const LINK_MAX_USES = 1;
/** A brand-new browser is trusted with the owner's account only on the link's first open, within this long
 *  after sending — WhatsApp's 24-hour customer-service window. Shorter would make late openers message again
 *  (an extra WhatsApp reply to pay for); the risk is limited to a link nobody has opened yet. */
export const FIRST_OPEN_MINUTES = 24 * 60;

/** Sent from the "Sign in with WhatsApp" button; the bot replies with a sign-in link to /me. */
export const ACCOUNT_WORD = "حسابي";

export type LinkPurpose = "ep_link" | "resume" | "pay" | "menu";

export async function mintLink(params: {
  viewerId: string;
  seriesId: string;
  episodeNumber: number;
  purpose?: LinkPurpose;
  /** The sequence, campaign or flow card the link was sent from (CTR meters). */
  ref?: MsgRef;
}): Promise<string> {
  const token = randomToken(24);
  const expiresAt = new Date(Date.now() + LINK_TTL_DAYS * 24 * 60 * 60 * 1000);
  const { error } = await db().from("link_tokens").insert({
    token_hash: sha256Hex(token),
    viewer_id: params.viewerId,
    purpose: params.purpose ?? "ep_link",
    series_id: params.seriesId,
    episode_number: params.episodeNumber,
    uses_left: LINK_MAX_USES,
    expires_at: expiresAt.toISOString(),
    ...refColumns(params.ref),
  });
  if (error) throw new Error(`mintLink failed: ${error.message}`);
  return `${await siteUrl()}/w/${token}`;
}

/** Sign-in link with no series: opens "My account" (/me). */
export async function mintAccountLink(viewerId: string): Promise<string> {
  const token = randomToken(24);
  const { error } = await db().from("link_tokens").insert({
    token_hash: sha256Hex(token),
    viewer_id: viewerId,
    purpose: "menu",
    series_id: null,
    episode_number: null,
    uses_left: LINK_MAX_USES,
    expires_at: new Date(Date.now() + LINK_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
  });
  if (error) throw new Error(`mintAccountLink failed: ${error.message}`);
  return `${await siteUrl()}/w/${token}`;
}

export const refColumns = (ref?: MsgRef) => (ref ? { ref_type: ref.type, ref_id: ref.id, node_id: ref.node ?? null } : {});

/** Tag a link that was minted before we knew which card sends it (flow link cards). */
export async function tagLink(url: string, ref: MsgRef): Promise<void> {
  const token = url.split("/w/")[1]?.split(/[?#]/)[0];
  if (!token || !TOKEN_RE.test(token)) return;
  await db().from("link_tokens").update(refColumns(ref)).eq("token_hash", sha256Hex(token)).is("ref_type", null);
}

/** The link's owner opened it (a click for the CTR meters). Only the first open counts. */
export async function markLinkOpened(token: string): Promise<void> {
  if (!TOKEN_RE.test(token)) return;
  await db().from("link_tokens").update({ opened_at: new Date().toISOString() }).eq("token_hash", sha256Hex(token)).is("opened_at", null);
}

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

export type LinkInfo = {
  viewerId: string;
  seriesId: string | null;
  episodeNumber: number | null;
  mintedAt: number;
  usesLeft: number;
  expired: boolean;
};

/** Read a link without using it up. */
export async function peekLink(token: string): Promise<LinkInfo | null> {
  if (!TOKEN_RE.test(token)) return null;
  const { data } = await db()
    .from("link_tokens")
    .select("viewer_id, series_id, episode_number, uses_left, created_at, expires_at")
    .eq("token_hash", sha256Hex(token))
    .maybeSingle();
  if (!data) return null;
  return {
    viewerId: data.viewer_id,
    seriesId: data.series_id,
    episodeNumber: data.episode_number,
    mintedAt: new Date(data.created_at).getTime(),
    usesLeft: data.uses_left,
    expired: new Date(data.expires_at).getTime() < Date.now(),
  };
}

export type LinkDecision = "open" | "open_as_current" | "sign_in_owner" | "sign_in_first_open" | "ask_whatsapp";

/**
 * What opening a personal link does.
 * @param current  viewer signed in on this browser right now (valid session), or null
 * @param browser  viewer this browser belonged to (even if that session went idle), or null
 */
export function decideLinkOpen(link: LinkInfo, current: string | null, browser: string | null, now = Date.now()): LinkDecision {
  if (current && current === link.viewerId) return "open";
  if (current) return "open_as_current"; // someone with their own account: never switch them over
  if (link.expired || now - link.mintedAt > LINK_TTL_DAYS * 24 * 3600 * 1000) return "ask_whatsapp";
  if (browser === link.viewerId) return "sign_in_owner"; // the owner's own browser, session went idle
  if (browser) return "ask_whatsapp"; // this browser belongs to someone else
  if (link.usesLeft > 0 && now - link.mintedAt <= FIRST_OPEN_MINUTES * 60 * 1000) return "sign_in_first_open";
  return "ask_whatsapp"; // unknown browser: forwarded, re-opened or late link
}

export type RedeemedLink = { viewerId: string; seriesId: string | null; episodeNumber: number | null };

/** Record the link's first open (atomic). Returns null if it was already opened (e.g. a simultaneous open) or expired. */
export async function redeemLink(token: string): Promise<RedeemedLink | null> {
  if (!TOKEN_RE.test(token)) return null;
  const { data, error } = await db().rpc("redeem_link_token", { p_token_hash: sha256Hex(token) });
  if (error) throw new Error(`redeemLink failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return null;
  return { viewerId: row.viewer_id, seriesId: row.series_id, episodeNumber: row.episode_number };
}
