// The Watchat connector for Claude (Admin → Studio → Connect Claude). Model Context Protocol over HTTP; the
// address carries a per-admin key (only its hash is stored; revocable, expires). Tools: src/lib/studio/tools.ts.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { sha256Hex } from "@/lib/crypto";
import { allow } from "@/lib/security/rate-limit";
import { handleRpc } from "@/lib/studio/mcp";
import { STUDIO_INSTRUCTIONS, studioTools, type StudioCtx } from "@/lib/studio/tools";
import { db } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 300;

const deny = (status: number, message: string) => NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message } }, { status });

async function contextFor(token: string): Promise<{ ctx: StudioCtx; tokenId: string } | null> {
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

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const who = await contextFor(token);
  // 404, not 401: a 401 makes Claude start an OAuth sign-in, which this connector doesn't use (the key is in the address).
  if (!who) return deny(404, "This connector address is not valid (or was removed). Create a new one in Watchat Admin → Studio.");
  // Plenty for one episode, but stops a runaway loop from hammering the site.
  if (!(await allow(`studio-mcp:${who.tokenId}`, 300, 3600))) return deny(429, "Too many requests this hour. Wait and try again.");
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  const out = await handleRpc(body, { name: "watchat-studio", version: "1.0.0", instructions: STUDIO_INSTRUCTIONS, tools: studioTools }, who.ctx);
  if (out === null) return new NextResponse(null, { status: 202 });
  return NextResponse.json(out);
}

// Streamable HTTP: no server-to-client stream here.
export function GET() {
  return new NextResponse("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}
export function DELETE() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
