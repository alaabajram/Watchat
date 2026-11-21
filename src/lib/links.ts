// Personal signed links: the bot sends watchat.pro/w/<token> in the viewer's own Watchat chat;
// opening it signs them in. Only the SHA-256 hash of the token is stored.
//
// The flow (decideLinkOpen):
//   • opened on a browser already signed in as the owner → open the episode;
//   • opened on a browser signed in to ANOTHER account (e.g. a link someone forwarded) → stay in that
//     viewer's own account and open the same episode on the web;
//   • opened with no sign-in → sign the owner in silently, every time, until the link expires — links
//     from the Watchat chat always recognise their owner;
//   • expired → continue in WhatsApp, where the bot sends a fresh link.
// To bring a friend, viewers use Share: it sends the Watchat chat link (wa.me/<number>?text=<series code>),
// so the friend starts in WhatsApp and the bot creates their own account from their number.

import { siteUrl } from "./site/store";
import { randomToken, sha256Hex } from "./crypto";
import { env } from "./env";
import type { MsgRef } from "./ctr/ctr";
import { db } from "./supabase";

/** A personal link signs its owner in, as often as they open it, for this long (same as a session). */
export const LINK_TTL_DAYS = 90;
/** uses_left only records whether the link has been opened yet (first-open stats). */
export const LINK_MAX_USES = 1;

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

/** Whether this link may still sign its owner in: any open until it expires. */
export function canSignIn(link: LinkInfo, now = Date.now()): boolean {
  return !link.expired && now - link.mintedAt <= LINK_TTL_DAYS * 24 * 3600 * 1000;
}

export type LinkDecision = "open" | "open_as_current" | "sign_in_owner" | "expired";

/** What opening a personal link does, given who (if anyone) is signed in on this browser. */
export function decideLinkOpen(link: LinkInfo, currentViewerId: string | null, now = Date.now()): LinkDecision {
  if (currentViewerId && currentViewerId === link.viewerId) return "open";
  if (currentViewerId) return "open_as_current"; // someone with their own account: never switch them over
  return canSignIn(link, now) ? "sign_in_owner" : "expired";
}

export type RedeemedLink = { viewerId: string; seriesId: string | null; episodeNumber: number | null };

/** Record the link's first open (atomic, for stats). Returns null if it was already opened or expired. */
export async function redeemLink(token: string): Promise<RedeemedLink | null> {
  if (!TOKEN_RE.test(token)) return null;
  const { data, error } = await db().rpc("redeem_link_token", { p_token_hash: sha256Hex(token) });
  if (error) throw new Error(`redeemLink failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return null;
  return { viewerId: row.viewer_id, seriesId: row.series_id, episodeNumber: row.episode_number };
}
