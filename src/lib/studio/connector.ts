// The Watchat connector for Claude (Admin → Studio → Connect Claude): Model Context Protocol over HTTP.
// The key comes in a request header (Authorization: Bearer <key>, preferred: the address alone is useless) or,
// for addresses made before headers, at the end of the address (/api/mcp/<key>). Only its hash is stored.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { sha256Hex } from "@/lib/crypto";
import { allow } from "@/lib/security/rate-limit";
import { db } from "@/lib/supabase";
import { handleRpc } from "./mcp";
import { STUDIO_INSTRUCTIONS, studioTools, type StudioCtx } from "./tools";

/** Every key the request carries (headers first, then the one at the end of the address); the first valid one is used. */
export function keyCandidates(h: Headers, fromPath?: string | null): string[] {
  const out: string[] = [];
  for (const name of ["x-api-key", "x-watchat-key", "authorization"]) {
    const v = (h.get(name) ?? "").trim().replace(/^Bearer\s+/i, "").trim();
    if (v && !/\s/.test(v) && !out.includes(v)) out.push(v);
  }
  if (fromPath && !out.includes(fromPath)) out.push(fromPath);
  return out;
}

/**
 * The key from "x-api-key: <key>" (what Claude's connector form offers; "Authorization" is reserved there for
 * OAuth), "X-Watchat-Key: <key>" or "Authorization: Bearer <key>". A leading "Bearer " is accepted in any of them.
 */
export function keyFromHeaders(h: Headers): string | null {
  for (const name of ["x-api-key", "x-watchat-key", "authorization"]) {
    const v = (h.get(name) ?? "").trim().replace(/^Bearer\s+/i, "").trim();
    if (v && !/\s/.test(v)) return v;
  }
  return null;
}

const deny = (status: number, message: string) => NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message } }, { status });

export async function contextFor(token: string): Promise<{ ctx: StudioCtx; tokenId: string } | null> {
  if (!/^[A-Za-z0-9_-]{30,100}$/.test(token)) return null;
  const { data } = await db()
    .from("studio_tokens")
    .select("id, tenant_id, admin_id, expires_at, revoked_at, last_used_at, admin_users!inner(name, email, role, disabled_at)")
    .eq("token_hash", sha256Hex(token))
    .maybeSingle();
  const admin = (data as unknown as { admin_users?: { name: string | null; email: string; role: string; disabled_at: string | null } } | null)?.admin_users;
  if (!data || data.revoked_at || new Date(data.expires_at) < new Date() || !admin || admin.disabled_at || !["owner", "content"].includes(admin.role)) return null;
  if (!data.last_used_at || Date.now() - new Date(data.last_used_at).getTime() > 5 * 60_000) {
    await db().from("studio_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  }
  return { ctx: { tenantId: data.tenant_id, adminId: data.admin_id, adminName: admin.name ?? admin.email }, tokenId: data.id };
}

export async function handleConnector(req: NextRequest, keys: string[]): Promise<NextResponse> {
  let who: Awaited<ReturnType<typeof contextFor>> = null;
  for (const k of keys.slice(0, 4)) {
    who = await contextFor(k);
    if (who) break;
  }
  // 404, not 401: a 401 makes Claude start an OAuth sign-in, which this connector doesn't use (the key is the sign-in).
  if (!who) return deny(404, "The Watchat connector key is missing, wrong or removed. Create a new one in Watchat Admin → Studio and put it in the connector's request header.");
  // Plenty for one episode, but stops a runaway loop from hammering the site.
  if (!(await allow(`studio-mcp:${who.tokenId}`, 300, 3600))) return deny(429, "Too many requests this hour. Wait and try again.");
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  const out = await handleRpc(body, { name: "watchat-studio", version: "1.1.0", instructions: STUDIO_INSTRUCTIONS, tools: studioTools }, who.ctx);
  if (out === null) return new NextResponse(null, { status: 202 });
  return NextResponse.json(out);
}

