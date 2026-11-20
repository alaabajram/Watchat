// P12 Wallet — balance, season passes and history, all tied to the viewer's WhatsApp number.

import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import { getSessionViewer } from "@/lib/session";
import { db } from "@/lib/supabase";
import { getBalance, getHistory } from "@/lib/wallet";
import { dirFor, formatMoney, webCopy } from "@/lib/web-copy";

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
  const [balance, history, { data: passes }, { data: pending }] = await Promise.all([
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
  ]);
  const fmt = new Intl.DateTimeFormat(locale === "ar" ? "ar-AE" : "en-AE", { dateStyle: "medium" });

  return (
    <main dir={dirFor(locale)}>
      <TopBar locale={locale} balance={balance} />
      <div className="page" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <h1 style={{ margin: 0 }}>{t.walletTitle}</h1>
        <div className="pack">
          <div>
            <div className="muted">{t.balance}</div>
            <strong style={{ fontSize: 32 }}>🪙 {balance}</strong>
          </div>
          <Link className="btn" href="/store?back=/wallet">
            {t.getCoins}
          </Link>
        </div>

        {(pending ?? []).length > 0 && (
          <section>
            <h2>{t.pendingOrders}</h2>
            <ul className="list">
              {(pending ?? []).map((o) => (
                <li key={o.id}>
                  <span>
                    {o.note}
                    <span className="muted" style={{ display: "block", fontSize: 13 }}>
                      {t.reference}: <span dir="ltr">{o.payment_ref}</span>
                    </span>
                  </span>
                  <strong>{formatMoney(Number(o.amount), o.currency as "AED" | "SAR", locale)}</strong>
                </li>
              ))}
            </ul>
          </section>
        )}

        {(passes ?? []).length > 0 && (
          <section>
            <h2>{t.passes}</h2>
            <ul className="list">
              {(passes as unknown as { series: { code: string; title_ar: string; title_en: string } }[]).map((p) => (
                <li key={p.series.code}>
                  <Link href={`/series/${p.series.code}`}>{locale === "en" ? p.series.title_en : p.series.title_ar}</Link>
                  <span>🎟️</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h2>{t.history}</h2>
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
                  <strong dir="ltr" style={{ color: h.delta > 0 ? "#4ade80" : "inherit" }}>
                    {h.delta > 0 ? `+${h.delta}` : h.delta}
                  </strong>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
