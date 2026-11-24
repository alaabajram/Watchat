// Older connector addresses carry the key at the end (/api/mcp/<key>); a key in the request header wins.
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { handleConnector, keyFromHeaders } from "@/lib/studio/connector";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handleConnector(req, keyFromHeaders(req.headers) ?? token);
}

// Streamable HTTP: no server-to-client stream here.
export function GET() {
  return new NextResponse("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}
export function DELETE() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
