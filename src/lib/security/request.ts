// Helpers for viewer API routes: same-origin check (CSRF), JSON body parsing, uniform errors.

import { NextResponse, type NextRequest } from "next/server";
import { env } from "../env";

/** Reject cross-site POSTs. Browsers always send Origin on POST; it must be our own site. */
export function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    const allowed = new URL(env.appUrl).origin;
    return origin === allowed || origin === req.nextUrl.origin;
  } catch {
    return false;
  }
}

export async function readJson<T>(req: NextRequest): Promise<T | null> {
  try {
    const text = await req.text();
    if (text.length > 10_000) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export const err = (status: number, error: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error, ...extra }, { status });
