// P12 Wallet — Ping balance, weekly / yearly pass (auto-renew), series passes, rewards and history, all tied to the viewer's WhatsApp number.

import Link from "next/link";
import { PlusIcon } from "@/components/brand/icons";
import { BottomNav } from "@/components/home/BottomNav";
import { TopBar } from "@/components/TopBar";
import { AutoRenewToggle } from "@/components/RewardsClient";
import { viewerPass } from "@/lib/economy/billing";
import { getSessionViewer } from "@/lib/session";
import { db } from "@/lib/supabase";
import { getBalance, getHistory } from "@/lib/wallet";
import { dirFor, formatMoney, webCopy } from "@/lib/web-copy";
import { PingIcon } from "@/components/brand/PingIcon";

export const dynamic = "force-dynamic";

export default async function WalletPage() {
  const viewer = await getSessionViewer();
  const locale = viewer?.uiLocale ?? "ar";
  const t = webCopy(locale);
  if (!viewer) {
    return (
      <main className="page center" dir={dirFor(locale)}>
        <p>{t.signInFromWhatsApp}</p>
      </main>
    );
  }
  const [balance, history, { data: passes }, { data: pending }, pass] = await Promise.all([
    getBalance(viewer.id),
    getHistory(viewer.id),
    db().from("entitlements").select("series_id, series!inner(code, title_ar, title_en)").eq("viewer_id", viewer.id).is("episode_number", null),
    db()
      .from("orders")
      .select("id, payment_ref, amount, currency, note, created_at")
      .eq("viewer_id", viewer.id)
      .eq("gateway", "cash")
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
    viewerPass(viewer.id),
  ]);
  const fmt = new Intl.DateTimeFormat(locale === "ar" ? "ar-AE" : "en-AE", { dateStyle: "medium" });

  return (
    <div className="wc wc-app" dir={dirFor(locale)} lang={locale}>
      <TopBar locale={locale} balance={balance} />
      <div className="page" style={{ display: "flex", flexDirection: "column", gap: 18, paddingTop: 8 }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>{t.walletTitle}</h1>
        <div className="wc-card" style={{ padding: 18, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <PingIcon size={56} />
            <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
              <strong style={{ fontSize: 32, fontWeight: 700 }}>{balance}</strong>
              <span className="muted" style={{ fontSize: 13 }}>{t.coinsAvailable}</span>
            </span>
          </div>
          <Link className="wc-btn" href="/store?back=/wallet" style={{ minHeight: 52, fontSize: 16 }}>
            <PlusIcon />
            {t.refillCoins}
          </Link>
        </div>

        {pass && (
          <section className="wc-card wc-plan wc-plan-on" style={{ gap: 8 }}>
            <strong>⭐ {t.yourPass}</strong>
            <span>{t.passUntil(pass.plan === "weekly" ? t.weeklyPass : pass.plan === "monthly" ? t.monthlyPass : t.yearlyPass, fmt.format(new Date(pass.endsAt)))}</span>
            {pass.pastDue && <span style={{ color: "var(--wc-coral-text)" }}>{t.pastDue}</span>}
            {pass.canRenew && (
              <>
                <span className="muted" style={{ fontSize: 13 }}>{pass.autoRenew ? t.autoRenewOn(pass.last4) : t.autoRenewOff}</span>
                <AutoRenewToggle locale={locale} on={pass.autoRenew} />
              </>
            )}
          </section>
        )}

        <Link href="/rewards" className="wc-card wc-promo-banner" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: "inherit" }}>
          <PingIcon size={32} />
          <span style={{ flex: 1 }}>
            <strong style={{ display: "block" }}>{t.rewardsTitle}</strong>
            <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>{t.dailyCheckin} · {t.inviteTitle}</span>
          </span>
          <span aria-hidden="true">{locale === "ar" ? "‹" : "›"}</span>
        </Link>

        {(pending ?? []).length > 0 && (
          <section>
            <h2 className="wc-section-title" style={{ marginBottom: 10 }}>{t.pendingOrders}</h2>
            <ul className="list">
              {(pending ?? []).map((o) => (
                <li key={o.id}>
                  <span>
                    {o.note}
                    <span className="muted" style={{ display: "block", fontSize: 13 }}>
                      {t.reference}: <span dir="ltr">{o.payment_ref}</span>
                    </span>
                  </span>
                  <strong>{formatMoney(Number(o.amount), o.currency, locale)}</strong>
                </li>
              ))}
            </ul>
          </section>
        )}

        {(passes ?? []).length > 0 && (
          <section>
            <h2 className="wc-section-title" style={{ marginBottom: 10 }}>{t.passes}</h2>
            <ul className="list">
              {(passes as unknown as { series: { code: string; title_ar: string; title_en: string } }[]).map((p) => (
                <li key={p.series.code}>
                  <Link href={`/series/${p.series.code}`}>{locale === "en" ? p.series.title_en : p.series.title_ar}</Link>
                  <span className="tag" style={{ background: "#e3fbf1", color: "var(--wc-mint-text)" }}>{t.seasonPass}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h2 className="wc-section-title" style={{ marginBottom: 10 }}>{t.history}</h2>
          {history.length === 0 ? (
            <p className="muted">{t.noHistory}</p>
          ) : (
            <ul className="list">
              {history.map((h) => (
                <li key={h.id}>
                  <span>
                    {t.reason[h.reason] ?? h.reason}
                    <span className="muted" style={{ display: "block", fontSize: 13 }}>
                      {fmt.format(new Date(h.created_at))}
                    </span>
                  </span>
                  <strong dir="ltr" style={{ color: h.delta > 0 ? "var(--wc-mint-text)" : "var(--wc-coral-text)" }}>
                    {h.delta > 0 ? `+${h.delta}` : h.delta}
                  </strong>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <BottomNav locale={locale} current="wallet" />
    </div>
  );
}
