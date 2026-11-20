// P9 Coin store — packs priced in the viewer's currency (AED or SAR), VAT included.

import { BuyButton } from "@/components/BuyButton";
import { TopBar } from "@/components/TopBar";
import { env } from "@/lib/env";
import { currencyFor } from "@/lib/phone";
import { getSessionViewer } from "@/lib/session";
import { currentTenantId, db } from "@/lib/supabase";
import { getBalance } from "@/lib/wallet";
import { dirFor, formatMoney, webCopy } from "@/lib/web-copy";

export const dynamic = "force-dynamic";

export default async function StorePage({ searchParams }: { searchParams: Promise<{ back?: string }> }) {
  const { back } = await searchParams;
  const viewer = await getSessionViewer();
  const locale = viewer?.uiLocale ?? "ar";
  const t = webCopy(locale);
  if (!viewer) {
    const wa = env.waDisplayNumber ? `https://wa.me/${env.waDisplayNumber}?text=LINK` : null;
    return (
      <main className="page center" dir={dirFor(locale)}>
        <p>{t.signInFromWhatsApp}</p>
        {wa && <a className="btn" href={wa}>{t.getFreshLink}</a>}
      </main>
    );
  }

  const returnTo = back && back.startsWith("/") && !back.startsWith("//") ? back : "/wallet";
  const currency = currencyFor(viewer.country);
  const tenantId = await currentTenantId();
  const [{ data: packs }, balance] = await Promise.all([
    db().from("coin_packs").select("id, coins, bonus_coins, price_aed, price_sar").eq("tenant_id", tenantId).eq("active", true).order("sort"),
    getBalance(viewer.id),
  ]);
  const list = packs ?? [];
  const bestId = list.reduce<{ id: string; per: number } | null>((best, p) => {
    const per = Number(currency === "SAR" ? p.price_sar : p.price_aed) / (p.coins + p.bonus_coins);
    return !best || per < best.per ? { id: p.id, per } : best;
  }, null)?.id;

  return (
    <main dir={dirFor(locale)}>
      <TopBar locale={locale} balance={balance} backHref={returnTo} />
      <div className="page" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h1 style={{ margin: 0 }}>{t.storeTitle}</h1>
        {list.map((p) => {
          const price = Number(currency === "SAR" ? p.price_sar : p.price_aed);
          const total = p.coins + p.bonus_coins;
          return (
            <div key={p.id} className="pack">
              <div>
                <strong style={{ fontSize: 20 }}>🪙 {total}</strong>{" "}
                {p.bonus_coins > 0 && <span className="tag">{t.bonus(p.bonus_coins)}</span>}{" "}
                {p.id === bestId && list.length > 1 && <span className="tag">{t.bestValue}</span>}
                <div className="muted">{t.approxEpisodes(Math.floor(total / 30))}</div>
              </div>
              <BuyButton locale={locale} type="coin_pack" id={p.id} label={formatMoney(price, currency, locale)} returnTo={returnTo} />
            </div>
          );
        })}
        <p className="muted" style={{ margin: 0 }}>
          {t.storeNote}
        </p>
      </div>
    </main>
  );
}
