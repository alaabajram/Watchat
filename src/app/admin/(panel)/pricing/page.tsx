// Pricing & Ping: the episode price in Ping, the countries we sell in (currency, VAT), one price grid for every
// market (weekly pass, yearly pass, series pass, Ping packs), the Ping packs themselves, and auto-renew.
// Rewards, promotions, invites and partners live in Offers & promotions.

import Link from "next/link";
import { Flash } from "@/components/admin/Flash";
import { requireAdmin } from "@/lib/admin/auth";
import { countryName } from "@/lib/economy/countries";
import { economySettings } from "@/lib/economy/store";
import { tapConfigured } from "@/lib/payments/tap";
import { db } from "@/lib/supabase";
import { saveMarketAction, savePingPackAction, savePriceGridAction, savePricingSettingsAction } from "../../economy-actions";

export const dynamic = "force-dynamic";

export default async function PricingPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const admin = await requireAdmin("pricing");
  const sp = await searchParams;
  const [settings, { data: markets }, { data: prices }, { data: packs }] = await Promise.all([
    economySettings(admin.tenantId),
    db().from("markets").select("country, currency, vat_rate, active, sort").eq("tenant_id", admin.tenantId).order("sort"),
    db().from("market_prices").select("country, item, price").eq("tenant_id", admin.tenantId),
    db().from("coin_packs").select("id, coins, bonus_coins, sort, active, label_ar, label_en").eq("tenant_id", admin.tenantId).order("sort"),
  ]);
  const marketList = markets ?? [];
  const priceOf = new Map((prices ?? []).map((p) => [`${p.country}:${p.item}`, Number(p.price)]));
  const livePacks = (packs ?? []).filter((p) => p.active);
  const oldPacks = (packs ?? []).filter((p) => !p.active);
  const items: { key: string; label: string; hint?: string }[] = [
    { key: "weekly", label: "Weekly pass", hint: "every series, 7 days" },
    { key: "yearly", label: "Yearly pass", hint: "every series, 1 year" },
    { key: "series_pass", label: "Series pass", hint: "one whole series" },
    ...livePacks.map((p) => ({ key: `pack:${p.id}`, label: `${p.coins + p.bonus_coins} Ping`, hint: p.bonus_coins ? `${p.coins} + ${p.bonus_coins} bonus` : undefined })),
  ];
  const usd = priceOf.get("ZZ:weekly");

  return (
    <>
      <h1>Pricing &amp; Ping</h1>
      <Flash ok={sp.ok} err={sp.err} />
      <p className="muted">
        Ping (بينج) is the viewer currency. New viewers get free Ping (set in <Link href="/admin/offers">Offers &amp; promotions</Link>), each paid
        episode costs Ping, and the weekly / yearly passes open every series with no Ping. Viewers see the prices of the country their IP is in
        (else their WhatsApp number&apos;s country; anywhere else gets the <em>Rest of world</em> prices).
      </p>

      <h2>Episodes &amp; renewals</h2>
      <form action={savePricingSettingsAction} className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="row">
          <label>
            Episode price (Ping)
            <input name="episode_ping" type="number" min={1} max={10000} defaultValue={settings.episodePing} style={{ width: 110 }} required />
          </label>
          <label className="inline" style={{ alignSelf: "end" }}>
            <input type="checkbox" name="apply_all" /> Apply to every series now
          </label>
          <label>
            Default country
            <select name="default_country" defaultValue={settings.defaultCountry}>
              {marketList.map((m) => (
                <option key={m.country} value={m.country}>
                  {countryName(m.country)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="inline">
          <input type="checkbox" name="recurring_enabled" defaultChecked={settings.recurringEnabled} /> Weekly / yearly passes renew automatically
        </label>
        <p className="muted" style={{ margin: 0 }}>
          Automatic renewal charges the card saved on the first payment. Turn it on only after Tap has enabled <strong>Save Card</strong> (recurring
          payments) on your merchant account — ask your Tap account manager. While it&apos;s off, passes are a single payment and viewers buy again
          when they end.
          {!tapConfigured() && " Tap isn't configured yet, so nothing renews."}
        </p>
        <div>
          <button type="submit">Save</button>
        </div>
      </form>

      <h2>Prices by country</h2>
      <p className="muted">
        VAT included, in each country&apos;s currency. Leave a box empty to stop selling that item there.
        {usd ? ` Reference: weekly ${usd} USD (Rest of world).` : ""} Keep packs above ~15 AED/SAR: card fees have a fixed part.
      </p>
      <form action={savePriceGridAction} className="card" style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Item</th>
              {marketList.map((m) => (
                <th key={m.country} style={{ opacity: m.active ? 1 : 0.5 }}>
                  {countryName(m.country)}
                  <span className="muted" style={{ display: "block", fontWeight: 400 }}>
                    {m.currency}
                    {Number(m.vat_rate) > 0 ? ` · VAT ${Math.round(Number(m.vat_rate) * 1000) / 10}%` : ""}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.key}>
                <td>
                  <strong>{it.label}</strong>
                  {it.hint && <span className="muted" style={{ display: "block", fontSize: 12 }}>{it.hint}</span>}
                </td>
                {marketList.map((m) => (
                  <td key={m.country}>
                    <input
                      name={`p:${m.country}:${it.key}`}
                      type="number"
                      step="0.001"
                      min={0}
                      defaultValue={priceOf.get(`${m.country}:${it.key}`) ?? ""}
                      style={{ width: 90 }}
                      aria-label={`${it.label} · ${countryName(m.country)}`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <button type="submit" style={{ marginTop: 10 }}>Save prices</button>
      </form>

      <h2>Countries</h2>
      <p className="muted">
        Two-letter country code (ZZ = everywhere else), its currency and VAT. Series can be limited to some of these countries on each series page
        (licensing).
      </p>
      {marketList.map((m) => (
        <form key={m.country} action={saveMarketAction} className="row card">
          <input type="hidden" name="country" value={m.country} />
          <strong style={{ alignSelf: "center", minWidth: 120 }}>
            {countryName(m.country)} <span className="muted">({m.country})</span>
          </strong>
          <label>
            Currency
            <input name="currency" defaultValue={m.currency} maxLength={3} style={{ width: 70 }} required />
          </label>
          <label>
            VAT %
            <input name="vat_pct" type="number" step="0.1" min={0} max={50} defaultValue={Math.round(Number(m.vat_rate) * 1000) / 10} style={{ width: 80 }} />
          </label>
          <label>
            Order
            <input name="sort" type="number" defaultValue={m.sort} style={{ width: 70 }} />
          </label>
          <label className="inline" style={{ alignSelf: "end" }}>
            <input type="checkbox" name="active" defaultChecked={m.active} /> Selling here
          </label>
          <button type="submit" className="secondary" style={{ alignSelf: "end" }}>Save</button>
        </form>
      ))}
      <form action={saveMarketAction} className="row card">
        <label>
          Country code
          <input name="country" maxLength={2} placeholder="EG" style={{ width: 70, textTransform: "uppercase" }} required />
        </label>
        <label>
          Currency
          <input name="currency" maxLength={3} placeholder="EGP" style={{ width: 70, textTransform: "uppercase" }} required />
        </label>
        <label>
          VAT %
          <input name="vat_pct" type="number" step="0.1" min={0} max={50} defaultValue={0} style={{ width: 80 }} />
        </label>
        <input type="hidden" name="active" value="on" />
        <button type="submit" style={{ alignSelf: "end" }}>Add country</button>
      </form>

      <h2>Ping packs</h2>
      <p className="muted">How much Ping each pack gives. Prices per country are in the grid above. 1 episode = {settings.episodePing} Ping.</p>
      {livePacks.map((p) => packRow(p))}
      <h3>New pack</h3>
      {packRow()}
      {oldPacks.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary className="muted">Packs off sale ({oldPacks.length})</summary>
          {oldPacks.map((p) => packRow(p))}
        </details>
      )}
    </>
  );
}

type PackRow = { id: string; coins: number; bonus_coins: number; sort: number; active: boolean; label_ar: string | null; label_en: string | null };

function packRow(p?: PackRow) {
  return (
    <form action={savePingPackAction} className="row card" key={p?.id ?? "new"}>
      {p && <input type="hidden" name="id" value={p.id} />}
      <label>
        Ping
        <input name="coins" type="number" min={1} defaultValue={p?.coins ?? ""} style={{ width: 100 }} required />
      </label>
      <label>
        Bonus Ping
        <input name="bonus_coins" type="number" min={0} defaultValue={p?.bonus_coins ?? 0} style={{ width: 90 }} />
      </label>
      <label>
        Label (AR)
        <input name="label_ar" defaultValue={p?.label_ar ?? ""} maxLength={40} dir="rtl" style={{ width: 120 }} />
      </label>
      <label>
        Label (EN)
        <input name="label_en" defaultValue={p?.label_en ?? ""} maxLength={40} style={{ width: 120 }} />
      </label>
      <label>
        Order
        <input name="sort" type="number" defaultValue={p?.sort ?? 0} style={{ width: 70 }} />
      </label>
      <label className="inline" style={{ alignSelf: "end" }}>
        <input type="checkbox" name="active" defaultChecked={p?.active ?? true} /> On sale
      </label>
      <button type="submit" style={{ alignSelf: "end" }}>{p ? "Save" : "Add pack"}</button>
    </form>
  );
}
