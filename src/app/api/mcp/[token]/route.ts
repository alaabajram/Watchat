// Connector addresses with the key at the end (/api/mcp/<key>); a key in a request header is tried too.
// Opening the address in a browser (GET) says whether the key works, so the team can check it.
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { contextFor, handleConnector, keyCandidates } from "@/lib/studio/connector";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handleConnector(req, keyCandidates(req.headers, token));
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ok = Boolean(await contextFor(token));
  const text = ok
    ? "✓ This Watchat connector address works. Paste it in Claude as a custom connector (no sign-in, no headers)."
    : "✗ This key isn't valid: it was removed, has expired or was copied incompletely. Create a new key in Watchat Admin → Studio.";
  return new NextResponse(text, { status: ok ? 200 : 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

export function DELETE() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
