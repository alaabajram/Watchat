// Keeps viewers signed in while they keep watching: every page visit pushes the session cookie's
// expiry 90 days ahead (the database side already counts 90 days from the last visit).
// No database work here; an invalid or revoked session is still rejected by getSessionViewer.

import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, SESSION_MAX_AGE_S } from "@/lib/session-cookie";

export default function proxy(req: NextRequest) {
  const res = NextResponse.next();
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token && req.method === "GET") {
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: req.nextUrl.protocol === "https:",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_S,
    });
  }
  return res;
}

export const config = {
  // Viewer pages only: not the API, admin, link redirects, static files or the ffmpeg bundle.
  matcher: ["/((?!api|admin|w/|_next|ffmpeg|favicon|.*\\..*).*)"],
};
