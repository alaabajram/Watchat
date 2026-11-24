// The Watchat connector (/api/mcp/<key>) is authorised by the key in its address, not OAuth. Answering 404 here
// tells MCP clients such as Claude not to look for a sign-in service.
import { NextResponse } from "next/server";

export function GET() {
  return new NextResponse(null, { status: 404 });
}
