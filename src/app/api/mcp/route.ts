// The Watchat connector address: https://<site>/api/mcp with the key in a request header
// (x-api-key, X-Watchat-Key or Authorization: Bearer). Addresses with the key at the end are in [token].
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { handleConnector, keyCandidates } from "@/lib/studio/connector";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  return handleConnector(req, keyCandidates(req.headers));
}

export function GET() {
  return new NextResponse("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}
export function DELETE() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
