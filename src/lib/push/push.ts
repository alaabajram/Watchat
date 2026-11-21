// Web push: the free way to reach viewers who turned on alerts in the web app (installed to their home screen
// or in their browser). Keys are created on first use and kept per label; the private key is sealed with
// SETTINGS_ENCRYPTION_KEY. Server only.

import webpush from "web-push";
import { env } from "../env";
import { openSecret, sealSecret } from "../secret-box";
import { siteUrl } from "../site/store";
import { db } from "../supabase";

export type PushPayload = { title: string; body: string; url: string; tag?: string; image?: string | null };

export async function pushKeys(tenantId: string): Promise<{ publicKey: string; privateKey: string; pushFirst: boolean }> {
  const { data } = await db().from("push_config").select("public_key, private_key_enc, push_first").eq("tenant_id", tenantId).maybeSingle();
  if (data) return { publicKey: data.public_key as string, privateKey: openSecret(data.private_key_enc as string, env.settingsEncryptionKey), pushFirst: Boolean(data.push_first) };
  const keys = webpush.generateVAPIDKeys();
  await db()
    .from("push_config")
    .upsert({ tenant_id: tenantId, public_key: keys.publicKey, private_key_enc: sealSecret(keys.privateKey, env.settingsEncryptionKey) }, { onConflict: "tenant_id", ignoreDuplicates: true });
  // Another request may have created them first: read back what's stored.
  const { data: stored } = await db().from("push_config").select("public_key, private_key_enc, push_first").eq("tenant_id", tenantId).single();
  return { publicKey: stored!.public_key as string, privateKey: openSecret(stored!.private_key_enc as string, env.settingsEncryptionKey), pushFirst: Boolean(stored!.push_first) };
}

export async function hasPush(viewerId: string): Promise<boolean> {
  const { count } = await db().from("push_subscriptions").select("id", { count: "exact", head: true }).eq("viewer_id", viewerId).is("revoked_at", null);
  return (count ?? 0) > 0;
}

/** Send to every browser / app the viewer turned alerts on in. True if at least one accepted it. */
export async function sendPush(tenantId: string, viewerId: string, payload: PushPayload): Promise<boolean> {
  const { data: subs } = await db().from("push_subscriptions").select("id, endpoint, p256dh, auth, failures").eq("viewer_id", viewerId).is("revoked_at", null);
  if (!subs?.length) return false;
  const keys = await pushKeys(tenantId);
  const vapidDetails = { subject: `${await siteUrl()}/about`, publicKey: keys.publicKey, privateKey: keys.privateKey };
  let delivered = false;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint as string, keys: { p256dh: s.p256dh as string, auth: s.auth as string } }, JSON.stringify(payload), {
        vapidDetails,
        TTL: 24 * 3600,
        urgency: "normal",
        timeout: 10_000,
      });
      delivered = true;
      await db().from("push_subscriptions").update({ last_ok_at: new Date().toISOString(), failures: 0 }).eq("id", s.id);
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode ?? 0;
      // 404 / 410: the viewer removed the app or turned notifications off. Stop using it.
      const gone = status === 404 || status === 410 || (s.failures as number) >= 4;
      await db()
        .from("push_subscriptions")
        .update({ failures: (s.failures as number) + 1, ...(gone ? { revoked_at: new Date().toISOString() } : {}) })
        .eq("id", s.id);
    }
  }
  return delivered;
}
