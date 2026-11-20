// Personal signed links: the bot sends watchat.pro/w/<token>; opening it signs the viewer in.
// Only the SHA-256 hash of the token is stored, so a database leak can't be used to sign in.
//
// A link signs in ONCE: its first open, within SIGN_IN_WINDOW_HOURS of being sent. After that the link
// only tells us which series/episode it was for, and the page asks the opener to continue in WhatsApp,
// where the bot sends a fresh link to *their own* number. So a forwarded link never opens the sender's
// account, wallet or progress — the receiver gets their own.

import { randomToken, sha256Hex } from "./crypto";
import { env } from "./env";
import type { MsgRef } from "./ctr/ctr";
import { db } from "./supabase";

/** Links stay readable (for the "continue in WhatsApp" page) for this long. */
export const LINK_TTL_DAYS = 7;
/** Each link can sign in exactly once. */
export const LINK_MAX_USES = 1;
/** …and only if opened within this many hours of being sent. */
export const SIGN_IN_WINDOW_HOURS = 24;
/** A link opened within this many minutes of being sent starts a trusted session (can top up without a code). */
export const FRESH_LINK_MINUTES = 30;

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
  return `${env.appUrl}/w/${token}`;
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
  return `${env.appUrl}/w/${token}`;
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

/** Whether this link may still sign someone in (first open, inside the window). */
export function canSignIn(link: LinkInfo, now = Date.now()): boolean {
  return !link.expired && link.usesLeft > 0 && now - link.mintedAt <= SIGN_IN_WINDOW_HOURS * 3600 * 1000;
}

/** Opened within minutes of being sent: almost certainly the number's owner. */
export function isFresh(link: LinkInfo, now = Date.now()): boolean {
  return now - link.mintedAt <= FRESH_LINK_MINUTES * 60 * 1000;
}

export type RedeemedLink = { viewerId: string; seriesId: string | null; episodeNumber: number | null };

/** Use up the link (atomic). Returns null if someone else used it a moment earlier, or it expired. */
export async function redeemLink(token: string): Promise<RedeemedLink | null> {
  if (!TOKEN_RE.test(token)) return null;
  const { data, error } = await db().rpc("redeem_link_token", { p_token_hash: sha256Hex(token) });
  if (error) throw new Error(`redeemLink failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return null;
  return { viewerId: row.viewer_id, seriesId: row.series_id, episodeNumber: row.episode_number };
}
