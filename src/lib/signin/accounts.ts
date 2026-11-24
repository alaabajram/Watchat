// One account, many ways in. Every sign-in (WhatsApp / phone number, Telegram, email) is a hash; it opens the
// account whose own hash it is, or the account it was added to (`viewer_logins`), following merged accounts to
// the one they became. Adding a way in that already opens another account asks to merge the two (merge_viewers
// moves Ping, passes, unlocked episodes, progress, story choices, My List and devices into the kept account).

import { randomToken, sha256Hex } from "../crypto";
import { botLink } from "../telegram/channel";
import { db } from "../supabase";

export type LoginKind = "phone" | "telegram" | "email";

const kindOfAddress = (phoneE164: string): LoginKind => (phoneE164.startsWith("+tg:") ? "telegram" : phoneE164.startsWith("+em:") ? "email" : "phone");

/** The account a sign-in hash opens now, and which kind of sign-in matched (so a phone code never opens a Telegram account by a hash clash). */
export async function resolveViewer(tenantId: string, hmac: string): Promise<{ id: string; kind: LoginKind } | null> {
  let id: string | null = null;
  let kind: LoginKind | null = null;
  const { data: own } = await db().from("viewers").select("id, phone_e164").eq("tenant_id", tenantId).eq("phone_hmac", hmac).maybeSingle();
  if (own) {
    id = own.id as string;
    kind = kindOfAddress(String(own.phone_e164));
  } else {
    const { data: added } = await db().from("viewer_logins").select("viewer_id, kind").eq("tenant_id", tenantId).eq("hmac", hmac).maybeSingle();
    if (added) {
      id = added.viewer_id as string;
      kind = added.kind as LoginKind;
    }
  }
  if (!id || !kind) return null;
  // Merged accounts point at the account they became.
  for (let hop = 0; hop < 5; hop++) {
    const { data: v } = await db().from("viewers").select("merged_into").eq("id", id).maybeSingle();
    if (!v?.merged_into) break;
    id = v.merged_into as string;
  }
  return { id, kind };
}

export type LoginRow = { kind: LoginKind; label: string | null; primary: boolean };

/** The ways into an account, for the Profile list. */
export async function loginsOf(viewerId: string): Promise<LoginRow[]> {
  const [{ data: v }, { data: added }] = await Promise.all([
    db().from("viewers").select("phone_e164").eq("id", viewerId).maybeSingle(),
    db().from("viewer_logins").select("kind, label, created_at").eq("viewer_id", viewerId).order("created_at"),
  ]);
  const out: LoginRow[] = [];
  if (v) {
    const p = String(v.phone_e164);
    const k = kindOfAddress(p);
    out.push({ kind: k, label: k === "phone" ? `${p.slice(0, 6)} ••• ${p.slice(-4)}` : null, primary: true });
  }
  for (const a of added ?? []) out.push({ kind: a.kind as LoginKind, label: (a.label as string | null) ?? null, primary: false });
  return out;
}

/** "a•••@gmail.com" */
export const maskEmail = (email: string) => {
  const [user, host] = email.split("@");
  return `${user.slice(0, 1)}•••@${host}`;
};

export type AccountSummary = { ping: number; passes: number; episodes: number; watched: number; since: string };
export type LinkResult = { ok: true; already?: boolean } | { ok: false; merge: { token: string; summary: AccountSummary } } | { ok: false; error: "wrong_kind" };

/**
 * Add a verified way in to `viewerId`. If it already opens another account, nothing changes yet: the answer
 * carries a merge request (10 minutes) and that account's summary, for the viewer to confirm.
 */
export async function addLogin(tenantId: string, viewerId: string, login: { hmac: string; kind: LoginKind; label: string | null }): Promise<LinkResult> {
  const owner = await resolveViewer(tenantId, login.hmac);
  if (owner && owner.kind !== login.kind) return { ok: false, error: "wrong_kind" };
  if (owner?.id === viewerId) return { ok: true, already: true };
  if (owner) {
    const token = randomToken(24);
    await db()
      .from("link_requests")
      .insert({ tenant_id: tenantId, viewer_id: viewerId, kind: "merge", token_hash: sha256Hex(token), payload: { from: owner.id }, expires_at: new Date(Date.now() + 10 * 60_000).toISOString() });
    return { ok: false, merge: { token, summary: await accountSummary(owner.id) } };
  }
  const { error } = await db().from("viewer_logins").insert({ tenant_id: tenantId, hmac: login.hmac, kind: login.kind, label: login.label, viewer_id: viewerId });
  if (error) throw new Error(`addLogin failed: ${error.message}`);
  return { ok: true };
}

/** What an account holds, so the viewer knows what a merge brings over. */
export async function accountSummary(viewerId: string): Promise<AccountSummary> {
  const [{ data: bal }, { count: passes }, { count: episodes }, { count: watched }, { data: v }] = await Promise.all([
    db().rpc("wallet_balance", { p_viewer: viewerId }),
    db().from("entitlements").select("series_id", { count: "exact", head: true }).eq("viewer_id", viewerId).is("episode_number", null),
    db().from("entitlements").select("series_id", { count: "exact", head: true }).eq("viewer_id", viewerId).not("episode_number", "is", null),
    db().from("progress").select("episode_id", { count: "exact", head: true }).eq("viewer_id", viewerId),
    db().from("viewers").select("created_at").eq("id", viewerId).maybeSingle(),
  ]);
  return { ping: Number(bal ?? 0), passes: passes ?? 0, episodes: episodes ?? 0, watched: watched ?? 0, since: String(v?.created_at ?? "") };
}

/** Do it: the account behind the merge request moves into the signed-in one. Only the viewer who asked can confirm. */
export async function confirmMerge(tenantId: string, viewerId: string, token: string): Promise<{ ok: true; ping: number } | { ok: false; error: "expired" }> {
  const { data: req } = await db()
    .from("link_requests")
    .update({ used_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("viewer_id", viewerId)
    .eq("kind", "merge")
    .eq("token_hash", sha256Hex(token))
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("payload")
    .maybeSingle();
  const from = (req?.payload as { from?: string } | null)?.from;
  if (!from || from === viewerId) return { ok: false, error: "expired" };
  try {
    return { ok: true, ping: await mergeNow(from, viewerId) };
  } catch (e) {
    console.error("[accounts] merge failed", e instanceof Error ? e.message : e);
    return { ok: false, error: "expired" };
  }
}

/** Merge right away (both ways in were proven in the same step, e.g. Telegram sharing its own verified number). */
export async function mergeNow(from: string, into: string): Promise<number> {
  const { data, error } = await db().rpc("merge_viewers", { p_from: from, p_into: into });
  if (error) throw new Error(`merge failed: ${error.message}`);
  return Number((data as { ping?: number } | null)?.ping ?? 0);
}

/** "Connect Telegram": a one-time bot link (30 minutes); opening it in Telegram adds that Telegram to the account. */
export async function telegramLinkFor(tenantId: string, viewerId: string): Promise<string | null> {
  const token = randomToken(24);
  await db()
    .from("link_requests")
    .insert({ tenant_id: tenantId, viewer_id: viewerId, kind: "telegram", token_hash: sha256Hex(token), expires_at: new Date(Date.now() + 30 * 60_000).toISOString() });
  return botLink(`link_${token}`);
}

/** The account that asked to connect Telegram with this bot link (used once). */
export async function useTelegramLink(token: string): Promise<{ viewerId: string; tenantId: string } | null> {
  const { data } = await db()
    .from("link_requests")
    .update({ used_at: new Date().toISOString() })
    .eq("kind", "telegram")
    .eq("token_hash", sha256Hex(token))
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("viewer_id, tenant_id")
    .maybeSingle();
  return data ? { viewerId: data.viewer_id as string, tenantId: data.tenant_id as string } : null;
}
