// P9 Store — weekly / yearly passes (every series) and Ping packs, priced in the viewer's market (their IP country,
// else their WhatsApp number's country, else international USD), VAT included, with the best promotion applied.

import { BuyButton } from "@/components/BuyButton";
import { PingIcon } from "@/components/brand/PingIcon";
import { BottomNav } from "@/components/home/BottomNav";
import { PromoCodeBox } from "@/components/PromoCodeBox";
import { TopBar } from "@/components/TopBar";
import { viewerPass } from "@/lib/economy/billing";
import { payingMarket, storeOffers } from "@/lib/economy/store";
import { isStars } from "@/lib/economy/pricing";
import { env } from "@/lib/env";
import { getSessionViewer } from "@/lib/session";
import { getBalance, paymentMode } from "@/lib/wallet";
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
  const market = await payingMarket(viewer); // Telegram viewers: Telegram Stars
  const [shop, balance, pass] = await Promise.all([storeOffers(viewer.id, market), getBalance(viewer.id), viewerPass(viewer.id)]);
  const cur = market.currency;
  const stars = isStars(market);
  const money = (n: number) => formatMoney(n, cur, locale);
  const perPing = (price: number, ping: number) => price / Math.max(1, ping);
  const bestId = shop.packs.reduce<{ id: string; per: number } | null>((best, { pack, quote }) => {
    const per = perPing(quote.price, quote.ping + quote.bonusPing);
    return !best || per < best.per ? { id: pack.id, per } : best;
  }, null)?.id;
  const yearlySaving =
    shop.weekly && shop.yearly ? Math.round((1 - shop.yearly.price / (shop.weekly.price * 52)) * 100) : 0;
  const fmtDate = new Intl.DateTimeFormat(locale === "ar" ? "ar-AE" : "en-AE", { dateStyle: "medium" });
  const banner = shop.banner ? (locale === "en" ? shop.banner.en : shop.banner.ar) : null;

  return (
    <div className="wc wc-app" dir={dirFor(locale)} lang={locale}>
      <TopBar locale={locale} balance={balance} backHref={returnTo} />
      <div className="page" style={{ display: "flex", flexDirection: "column", gap: 14, paddingTop: 8 }}>
        <h1 style={{ margin: "0 0 2px", fontSize: 26, fontWeight: 700 }}>{t.storeTitle}</h1>
        {(banner || shop.firstPurchase > 0) && (
          <div className="wc-promo-banner" role="note">
            {banner ?? t.firstPurchase(shop.firstPurchase)}
          </div>
        )}

        {/* Passes: every series, no Ping */}
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 className="wc-section-title" style={{ margin: 0 }}>{t.allAccess}</h2>
          {pass ? (
            <a href="/wallet" className="wc-card wc-plan wc-plan-on">
              <strong>⭐ {t.yourPass}</strong>
              <span>{t.passUntil(pass.plan === "weekly" ? t.weeklyPass : pass.plan === "monthly" ? t.monthlyPass : t.yearlyPass, fmtDate.format(new Date(pass.endsAt)))}</span>
            </a>
          ) : (
            <>
              <p className="muted" style={{ margin: 0 }}>{t.passPerks}</p>
              <div className="wc-plans">
                {shop.weekly && (
                  <div className="wc-card wc-plan">
                    <strong>{t.weeklyPass}</strong>
                    <PriceLine quote={shop.weekly} money={money} />
                    <span className="muted" style={{ fontSize: 13 }}>{t.perWeek}</span>
                    <BuyButton locale={locale} type="subscription" id="weekly" label={t.buy} returnTo={returnTo} secondary />
                  </div>
                )}
                {shop.monthly && (
                  <div className="wc-card wc-plan">
                    <strong>{t.monthlyPass}</strong>
                    <PriceLine quote={shop.monthly} money={money} />
                    <span className="muted" style={{ fontSize: 13 }}>{t.perMonth}</span>
                    <BuyButton locale={locale} type="subscription" id="monthly" label={t.buy} returnTo={returnTo} secondary />
                  </div>
                )}
                {shop.yearly && (
                  <div className="wc-card wc-plan wc-plan-best">
                    {yearlySaving > 0 && <span className="tag wc-plan-badge">{t.yearlySaving(yearlySaving)}</span>}
                    <strong>{t.yearlyPass}</strong>
                    <PriceLine quote={shop.yearly} money={money} />
                    <span className="muted" style={{ fontSize: 13 }}>{t.perYear}</span>
                    <BuyButton locale={locale} type="subscription" id="yearly" label={t.buy} returnTo={returnTo} />
                  </div>
                )}
              </div>
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>{stars ? t.starsRenews : shop.recurring ? t.renewsAuto : t.oneTimePass}</p>
            </>
          )}
        </section>

        {/* Ping packs */}
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 className="wc-section-title" style={{ margin: 0 }}>{t.pingPacks}</h2>
          {shop.packs.map(({ pack, quote }) => {
            const total = quote.ping + quote.bonusPing;
            const extra = pack.bonus + quote.bonusPing;
            return (
              <div key={pack.id} className="pack">
                <PingIcon size={48} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: 20 }}>{t.coins(total)}</strong>{" "}
                  {extra > 0 && <span className="tag">{t.bonus(extra)}</span>}{" "}
                  {pack.id === bestId && shop.packs.length > 1 && <span className="tag">{t.bestValue}</span>}
                  <div className="muted">{t.approxEpisodes(Math.floor(total / Math.max(1, shop.episodePing)))}</div>
                </div>
                <BuyButton locale={locale} type="coin_pack" id={pack.id} label={money(quote.price)} returnTo={returnTo} />
              </div>
            );
          })}
        </section>

        <PromoCodeBox locale={locale} />
        <p className="muted" style={{ margin: 0 }}>{t.seriesPassNote(shop.episodePing)}</p>
        <p className="muted" style={{ margin: 0 }}>
          {stars ? t.starsNote : paymentMode() === "cash" ? t.storeNoteCash : t.storeNote}
        </p>
      </div>
      <BottomNav locale={locale} current="coins" />
    </div>
  );
}

function PriceLine({ quote, money }: { quote: { price: number; listPrice: number }; money: (n: number) => string }) {
  return (
    <span style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
      <span style={{ fontSize: 22, fontWeight: 700 }}>{money(quote.price)}</span>
      {quote.price < quote.listPrice && <s className="muted" style={{ fontSize: 14 }}>{money(quote.listPrice)}</s>}
    </span>
  );
}
