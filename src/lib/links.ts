// Personal signed links: the bot sends watchat.tv/w/<token>; opening it signs the viewer in.
// Only the SHA-256 hash of the token is stored, so a database leak can't be used to sign in.

import { randomToken, sha256Hex } from "./crypto";
import { env } from "./env";
import { db } from "./supabase";

export const LINK_TTL_DAYS = 7;
export const LINK_MAX_USES = 3;

export type LinkPurpose = "ep_link" | "resume" | "pay" | "menu";

export async function mintLink(params: {
  viewerId: string;
  seriesId: string;
  episodeNumber: number;
  purpose?: LinkPurpose;
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
  });
  if (error) throw new Error(`mintLink failed: ${error.message}`);
  return `${env.appUrl}/w/${token}`;
}

export type RedeemedLink = {
  viewerId: string;
  seriesId: string | null;
  episodeNumber: number | null;
  /** First open of a link that was sent minutes ago: almost certainly the number's owner. */
  fresh: boolean;
};

/** A link opened for the first time within this many minutes of being sent starts a trusted session. */
export const FRESH_LINK_MINUTES = 30;

/** Consume one use of a link. Returns null if the token is unknown, expired or used up. */
export async function redeemLink(token: string): Promise<RedeemedLink | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const { data, error } = await db().rpc("redeem_link_token", { p_token_hash: sha256Hex(token) });
  if (error) throw new Error(`redeemLink failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return null;
  const mintedAt = row.minted_at ? new Date(row.minted_at).getTime() : 0;
  const fresh = row.first_use === true && Date.now() - mintedAt < FRESH_LINK_MINUTES * 60 * 1000;
  return { viewerId: row.viewer_id, seriesId: row.series_id, episodeNumber: row.episode_number, fresh };
}
