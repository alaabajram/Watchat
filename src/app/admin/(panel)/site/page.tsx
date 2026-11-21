// Admin → Settings → Brand & site: everything a label needs without touching the hosting settings.

import { SitePagesEditor } from "@/components/admin/SitePagesEditor";
import { SiteSettingsForm } from "@/components/admin/SiteSettingsForm";
import { Flash } from "@/components/admin/Flash";
import { requireAdmin } from "@/lib/admin/auth";
import { telegramStatus } from "@/lib/telegram/client";
import { connectTelegramAction } from "../../telegram-actions";
import { moveFilesToCloudflareAction, supabaseLinks } from "../../storage-actions";
import { storageStatus } from "@/lib/storage/cloudflare";
import { DEFAULT_SITE } from "@/lib/site/brand";
import { defaultPages } from "@/lib/site/defaults";
import { getPages, getSite } from "@/lib/site/store";

export const dynamic = "force-dynamic";

function detected(): string | null {
  const explicit = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  return process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null;
}

export default async function SitePage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const admin = await requireAdmin("site");
  const sp = await searchParams;
  const [site, pages, tg, old] = await Promise.all([getSite(admin.tenantId), getPages(admin.tenantId), telegramStatus(), supabaseLinks()]);
  const store = storageStatus();
  const stream = Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_STREAM_API_TOKEN && process.env.CLOUDFLARE_STREAM_CUSTOMER_CODE);
  const custom = (v: string, d: string) => (v === d ? null : v);

  return (
    <>
      <h1>Brand &amp; site</h1>
      <Flash ok={sp.ok} err={sp.err} />
      <p className="muted" style={{ marginTop: 0 }}>
        Your label&apos;s address, name, logos, colours, contacts and public pages. Changes apply to the viewer site, the bot&apos;s links and the admin,
        with nothing to set up on the hosting.
      </p>
      <SiteSettingsForm
        detectedUrl={detected()}
        initial={{
          appUrl: site.appUrl ?? "",
          nameAr: site.nameAr === DEFAULT_SITE.nameAr ? "" : site.nameAr,
          nameEn: site.nameEn === DEFAULT_SITE.nameEn ? "" : site.nameEn,
          logoOnLight: custom(site.logoOnLight, DEFAULT_SITE.logoOnLight),
          logoOnDark: custom(site.logoOnDark, DEFAULT_SITE.logoOnDark),
          icon: custom(site.icon, DEFAULT_SITE.icon),
          colorPrimary: site.colorPrimary,
          colorAccent: site.colorAccent,
          supportEmail: site.supportEmail ?? "",
          supportWhatsapp: site.supportWhatsapp ?? "",
          businessEmail: site.businessEmail ?? "",
        }}
      />
      <section className="card" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}>Telegram</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          A second chat channel: the same series, flows, shared replies, Ping wallet and watch feed, inside Telegram. Messages are free. Viewers
          start at {tg.username ? <a href={`https://t.me/${tg.username}`} target="_blank" rel="noreferrer">t.me/{tg.username}</a> : "your bot"}; a series opens with{" "}
          <code dir="ltr">t.me/{tg.username ?? "YourBot"}?start=SERIESCODE</code>, invites with <code dir="ltr">?start=INV-CODE</code> and partners with{" "}
          <code dir="ltr">?start=P-CODE</code>.
        </p>
        {!tg.configured ? (
          <p>
            Not set up: create the bot with @BotFather, add its token as <code>TELEGRAM_BOT_TOKEN</code> in Vercel → Settings → Environment
            Variables, redeploy, then come back here.
          </p>
        ) : (
          <>
            <p style={{ margin: "0 0 8px" }}>
              Bot: <strong>{tg.username ? `@${tg.username}` : "token not accepted"}</strong> · Webhook:{" "}
              <strong style={{ color: tg.webhookOk ? "var(--ok, #15803d)" : "var(--err, #b91c1c)" }}>{tg.webhookOk ? "connected" : "not connected"}</strong>
              {tg.pending > 0 && ` · ${tg.pending} waiting`}
            </p>
            {tg.lastError && <p className="muted" style={{ margin: "0 0 8px" }}>Last error from Telegram: {tg.lastError}</p>}
            {tg.webhookOk && !tg.paymentsReady && (
              <p style={{ margin: "0 0 8px", color: "var(--err, #b91c1c)" }}>Press Reconnect once to turn on Telegram Stars payments.</p>
            )}
            <form action={connectTelegramAction}>
              <button type="submit">{tg.webhookOk ? "Reconnect" : "Connect Telegram"}</button>
            </form>
            <p className="muted" style={{ marginBottom: 0 }}>
              Connecting sets the webhook, the bot&apos;s menu button «شاهد» (opens Watchat inside Telegram, signed in) and its commands. Telegram
              viewers pay in Telegram Stars ⭐ (prices in Pricing &amp; Ping).
            </p>
          </>
        )}
      </section>
      <section className="card" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}>Storage</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Where uploads go. Pictures (posters, banners, card images, logos) → Cloudflare Images. WhatsApp videos, trailers and subtitles →
          Cloudflare R2. Full web episodes → Cloudflare Stream. Anything not set up yet still goes to Supabase.
        </p>
        <ul style={{ margin: "0 0 12px", paddingInlineStart: 18, lineHeight: 1.8 }}>
          <li>Cloudflare Images: {store.images ? "✓ connected" : "not set up (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_STREAM_API_TOKEN, CLOUDFLARE_IMAGES_ACCOUNT_HASH)"}</li>
          <li>Cloudflare R2: {store.r2 ? "✓ connected" : "not set up (R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL)"}</li>
          <li>Cloudflare Stream: {stream ? "✓ connected" : "not set up (CLOUDFLARE_STREAM_CUSTOMER_CODE …)"}</li>
        </ul>
        {old === null ? (
          <p className="muted" style={{ margin: 0 }}>Moving older files needs the storage database update.</p>
        ) : old.images.length + old.files.length === 0 ? (
          <p style={{ margin: 0 }}>✓ No files left in Supabase storage.</p>
        ) : (
          <form action={moveFilesToCloudflareAction} className="row" style={{ gap: 12, alignItems: "center" }}>
            <button type="submit" disabled={!store.images && !store.r2}>
              Move existing files to Cloudflare
            </button>
            <span className="muted">
              Still in Supabase: {old.images.length} picture{old.images.length === 1 ? "" : "s"}, {old.files.length} other file{old.files.length === 1 ? "" : "s"}. Every
              link (series, episodes, flow cards, library, logos) is updated to the copy; the originals stay in Supabase as a backup.
            </span>
          </form>
        )}
      </section>
      <SitePagesEditor pages={pages} defaults={defaultPages(site.nameAr, site.nameEn, site.supportEmail)} />
    </>
  );
}
