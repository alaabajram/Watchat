// Fixed-window rate limiting backed by Postgres (works across all serverless instances).

import { db } from "../supabase";

/** Returns true if the action is allowed. Fails open (allows) only if the database is unreachable. */
export async function allow(key: string, max: number, windowSeconds: number): Promise<boolean> {
  const { data, error } = await db().rpc("hit_rate_limit", {
    p_key: key,
    p_max: max,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error("[rate-limit] check failed", error.message);
    return true;
  }
  return data === true;
}

/** Best-effort client IP from Vercel's headers. */
export function clientIp(headers: Headers): string {
  return headers.get("x-real-ip") ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}
