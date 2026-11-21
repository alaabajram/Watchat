// Mini App sign-in: Telegram hands the Mini App signed init data (the viewer's Telegram id). We verify the
// signature with the bot token, find or create that viewer ("tg:<id>", welcome Ping on first visit) and set the
// same session cookie a WhatsApp link would — no code, no form.

import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseDeps, phoneHmac } from "@/lib/bot/deps-supabase";
import { env } from "@/lib/env";
import { trackEvent } from "@/lib/events";
import { allow, clientIp } from "@/lib/security/rate-limit";
import { readJson } from "@/lib/security/request";
import { createSession, SESSION_COOKIE, SESSION_COOKIE_MAX_AGE_S } from "@/lib/session";
import { sessionCookieOptions } from "@/lib/session-cookie";
import { siteUrl } from "@/lib/site/store";
import { currentTenantId, db } from "@/lib/supabase";
import { startTarget, tgAddress, verifyInitData } from "@/lib/telegram/telegram";
import { CHANNEL_COOKIE } from "@/lib/telegram/channel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!env.telegramBotToken) return NextResponse.json({ error: "not_configured" }, { status: 404 });
  const ip = clientIp(req.headers);
  if (!(await allow(`tgauth:${ip}`, 30, 60))) return NextResponse.json({ error: "slow_down" }, { status: 429 });
  const body = await readJson<{ initData?: string; to?: string; framed?: boolean }>(req);
  const user = verifyInitData(String(body?.initData ?? ""), env.telegramBotToken, Math.floor(Date.now() / 1000));
  if (!user) return NextResponse.json({ error: "invalid" }, { status: 401 });

  const address = tgAddress(user.id);
  const hmac = phoneHmac(address);
  const tenantId = await currentTenantId();
  const { data: existing } = await db().from("viewers").select("id").eq("tenant_id", tenantId).eq("phone_hmac", hmac).maybeSingle();
  let viewerId = existing?.id as string | undefined;
  if (!viewerId) {
    // First visit from the Mini App: the same new-viewer path as a first chat message (welcome Ping, start code).
    const created = await createSupabaseDeps().upsertViewer({
      id: `tgapp:${user.id}`,
      from: address,
      timestamp: Math.floor(Date.now() / 1000),
      profileName: user.firstName ?? undefined,
      kind: "text",
      text: user.startParam ?? "",
    });
    viewerId = created.id;
    if (user.language?.startsWith("en")) await db().from("viewers").update({ ui_locale: "en" }).eq("id", viewerId);
    await trackEvent({ viewerHmac: hmac, name: "telegram_joined", props: { via: "mini_app" } });
  }

  const session = await createSession(viewerId, { userAgent: req.headers.get("user-agent"), ip });
  const asked = typeof body?.to === "string" && body.to.startsWith("/") && !body.to.startsWith("//") ? body.to : null;
  const base = await siteUrl();
  const res = NextResponse.json({ ok: true, to: asked ?? startTarget(user.startParam) });
  // The Mini App may be inside a frame on telegram.org (Telegram Web / Desktop): the page tells us.
  const framed = body?.framed === true && base.startsWith("https://");
  res.cookies.set(SESSION_COOKIE, session, { ...sessionCookieOptions(framed, base.startsWith("https://")), maxAge: SESSION_COOKIE_MAX_AGE_S });
  // Remember this browser came from Telegram, so signed-out screens offer Telegram (not WhatsApp).
  res.cookies.set(CHANNEL_COOKIE, "tg", { ...sessionCookieOptions(framed, base.startsWith("https://")), httpOnly: false, maxAge: 365 * 86400 });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
