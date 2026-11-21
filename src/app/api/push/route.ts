// Web push for the signed-in viewer.
// GET: the public key and whether this viewer has alerts on here. POST: save this browser / app's subscription.
// DELETE: turn alerts off for this browser / app.

import { NextResponse } from "next/server";
import { pushKeys } from "@/lib/push/push";
import { getSessionViewer } from "@/lib/session";
import { allow } from "@/lib/security/rate-limit";
import { currentTenantId, db } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const str = (v: unknown, max: number) => (typeof v === "string" && v.length <= max ? v : null);

export async function GET(req: Request) {
  const viewer = await getSessionViewer();
  if (!viewer) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  const endpoint = new URL(req.url).searchParams.get("endpoint");
  const { publicKey } = await pushKeys(await currentTenantId());
  let subscribed = false;
  if (endpoint) {
    const { data } = await db().from("push_subscriptions").select("id").eq("viewer_id", viewer.id).eq("endpoint", endpoint).is("revoked_at", null).maybeSingle();
    subscribed = Boolean(data);
  }
  return NextResponse.json({ publicKey, subscribed }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const viewer = await getSessionViewer();
  if (!viewer) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  if (!(await allow(`push:${viewer.id}`, 10, 3600))) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const body = (await req.json().catch(() => ({}))) as { subscription?: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }; platform?: unknown; installed?: unknown };
  const endpoint = str(body.subscription?.endpoint, 1000);
  const p256dh = str(body.subscription?.keys?.p256dh, 200);
  const auth = str(body.subscription?.keys?.auth, 100);
  if (!endpoint || !/^https:\/\//.test(endpoint) || !p256dh || !auth) return NextResponse.json({ error: "bad_subscription" }, { status: 400 });
  const platform = ["ios", "android", "desktop"].includes(String(body.platform)) ? String(body.platform) : null;
  const { error } = await db()
    .from("push_subscriptions")
    .upsert(
      { tenant_id: await currentTenantId(), viewer_id: viewer.id, endpoint, p256dh, auth, platform, installed: body.installed === true, revoked_at: null, failures: 0, last_ok_at: new Date().toISOString() },
      { onConflict: "endpoint" },
    );
  if (error) return NextResponse.json({ error: "save_failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const viewer = await getSessionViewer();
  if (!viewer) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { endpoint?: unknown };
  const endpoint = str(body.endpoint, 1000);
  if (endpoint) await db().from("push_subscriptions").update({ revoked_at: new Date().toISOString() }).eq("viewer_id", viewer.id).eq("endpoint", endpoint);
  return NextResponse.json({ ok: true });
}
