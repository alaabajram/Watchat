// Share taps on Playground pages (sendBeacon): one analytics event, nothing else.

import { NextResponse, type NextRequest } from "next/server";
import { trackEvent } from "@/lib/events";
import { allow } from "@/lib/security/rate-limit";
import { readJson, sameOrigin } from "@/lib/security/request";
import { getSessionViewer } from "@/lib/session";

export const runtime = "nodejs";
const EVENTS = new Set(["room_share", "card_share", "horoscope_share"]);

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return new NextResponse(null, { status: 204 });
  const viewer = await getSessionViewer();
  const body = await readJson<{ event?: string }>(req);
  if (viewer && body?.event && EVENTS.has(body.event) && (await allow(`share:${viewer.id}`, 30, 600))) {
    await trackEvent({ viewerHmac: viewer.phoneHmac, name: body.event });
  }
  return new NextResponse(null, { status: 204 });
}
