// Ping economy, server side: platform settings, markets and price lists from the database, the viewer's market
// from their IP (Vercel's x-vercel-ip-country), quotes and licensing. Server only.

import { cache } from "react";
import { headers } from "next/headers";
import { currentTenantId, db } from "../supabase";
import {
  FALLBACK_COUNTRY,
  isStars,
  STARS_MARKET,
  licensedIn,
  promoApplies,
  quote,
  resolveMarket,
  type Market,
  type PriceItem,
  type PriceList,
  type Promotion,
  type Quote,
  type ViewerFacts,
} from "./pricing";

export type EconomySettings = {
  welcomePing: number;
  episodePing: number;
  checkinLadder: number[];
  firstPurchaseBonusPct: number;
  referralFriendPing: number;
  referralReferrerPing: number;
  referralMonthlyCap: number;
  recurringEnabled: boolean;
  defaultCountry: string;
};

export const DEFAULT_SETTINGS: EconomySettings = {
  welcomePing: 50,
  episodePing: 10,
  checkinLadder: [2, 2, 3, 3, 5, 5, 10],
  firstPurchaseBonusPct: 20,
  referralFriendPing: 20,
  referralReferrerPing: 50,
  referralMonthlyCap: 20,
  recurringEnabled: false,
  defaultCountry: "AE",
};

export type Pack = { id: string; coins: number; bonus: number; sort: number; labelAr: string | null; labelEn: string | null };

export type Economy = {
  tenantId: string;
  settings: EconomySettings;
  markets: Market[];
  prices: PriceList;
  packs: Pack[];
  promotions: Promotion[];
  /** Telegram Stars prices (one list for every Telegram viewer). */
  stars: Partial<Record<PriceItem, number>>;
};

export const economySettings = cache(async (tenantId?: string): Promise<EconomySettings> => {
  const tid = tenantId ?? (await currentTenantId());
  const { data } = await db().from("economy_settings").select("*").eq("tenant_id", tid).maybeSingle();
  if (!data) return DEFAULT_SETTINGS;
  return {
    welcomePing: data.welcome_ping,
    episodePing: data.episode_ping,
    checkinLadder: (data.checkin_ladder as number[] | null) ?? DEFAULT_SETTINGS.checkinLadder,
    firstPurchaseBonusPct: data.first_purchase_bonus_pct,
    referralFriendPing: data.referral_friend_ping,
    referralReferrerPing: data.referral_referrer_ping,
    referralMonthlyCap: data.referral_monthly_cap,
    recurringEnabled: data.recurring_enabled,
    defaultCountry: data.default_country,
  };
});

export function toPromotion(r: Record<string, unknown>): Promotion {
  return {
    id: r.id as string,
    name: r.name as string,
    kind: r.kind as Promotion["kind"],
    value: Number(r.value),
    appliesTo: r.applies_to as Promotion["appliesTo"],
    code: (r.code as string | null) ?? null,
    audience: r.audience as Promotion["audience"],
    countries: (r.countries as string[] | null) ?? [],
    startsAt: (r.starts_at as string | null) ?? null,
    endsAt: (r.ends_at as string | null) ?? null,
    maxRedemptions: (r.max_redemptions as number | null) ?? null,
    perViewer: Number(r.per_viewer ?? 1),
    redemptions: Number(r.redemptions ?? 0),
    bannerAr: (r.banner_ar as string | null) ?? null,
    bannerEn: (r.banner_en as string | null) ?? null,
    active: Boolean(r.active),
  };
}

/** Everything pricing needs, read once per request. */
export const loadEconomy = cache(async (): Promise<Economy> => {
  const tenantId = await currentTenantId();
  const [settings, { data: markets }, { data: prices }, { data: packs }, { data: promos }, { data: stars }] = await Promise.all([
    economySettings(tenantId),
    db().from("markets").select("country, currency, vat_rate, active, sort").eq("tenant_id", tenantId).order("sort"),
    db().from("market_prices").select("country, item, price").eq("tenant_id", tenantId),
    db().from("coin_packs").select("id, coins, bonus_coins, sort, label_ar, label_en").eq("tenant_id", tenantId).eq("active", true).order("sort"),
    db().from("promotions").select("*").eq("tenant_id", tenantId).eq("active", true),
    db().from("stars_prices").select("item, stars").eq("tenant_id", tenantId),
  ]);
  const starList: Partial<Record<PriceItem, number>> = {};
  for (const s of stars ?? []) starList[s.item as PriceItem] = Number(s.stars);
  const list: PriceList = {};
  for (const p of prices ?? []) (list[p.country] ??= {})[p.item as PriceItem] = Number(p.price);
  return {
    tenantId,
    settings,
    markets: (markets ?? []).map((m) => ({ country: m.country, currency: m.currency, vatRate: Number(m.vat_rate), active: m.active })),
    prices: list,
    stars: starList,
    packs: (packs ?? []).map((p) => ({ id: p.id, coins: p.coins, bonus: p.bonus_coins, sort: p.sort, labelAr: p.label_ar, labelEn: p.label_en })),
    promotions: (promos ?? []).map(toPromotion),
  };
});

/** Country of this request's IP (set by Vercel; absent locally). */
export async function requestCountry(): Promise<string | null> {
  try {
    const h = await headers();
    const c = (h.get("x-vercel-ip-country") ?? h.get("cf-ipcountry") ?? "").toUpperCase();
    return /^[A-Z]{2}$/.test(c) && c !== "XX" ? c : null;
  } catch {
    return null; // outside a request (cron)
  }
}

/** The market a viewer is priced and licensed in. Also remembers the IP country on the viewer (for the bot). */
export async function viewerMarket(viewer: { id: string; country: string | null } | null): Promise<Market> {
  const eco = await loadEconomy();
  const ip = await requestCountry();
  if (viewer && ip) void rememberCountry(viewer.id, ip);
  let ipCountry = ip;
  if (!ipCountry && viewer) {
    const { data } = await db().from("viewers").select("ip_country").eq("id", viewer.id).maybeSingle();
    ipCountry = (data?.ip_country as string | null) ?? null;
  }
  return resolveMarket(eco.markets, { ipCountry, phoneCountry: viewer?.country ?? null, defaultCountry: eco.settings.defaultCountry });
}

const remembered = new Map<string, string>();
async function rememberCountry(viewerId: string, country: string) {
  if (remembered.get(viewerId) === country) return;
  remembered.set(viewerId, country);
  await db().from("viewers").update({ ip_country: country }).eq("id", viewerId);
}

/**
 * Geo-fencing: the market of this request's IP (international "ZZ" for countries we don't sell in, the default
 * country when there's no IP, e.g. locally). Licensing on the web follows the IP, not the phone number.
 */
export const ipMarket = cache(async (): Promise<Market> => {
  const eco = await loadEconomy();
  const ip = await requestCountry();
  return resolveMarket(eco.markets, { ipCountry: ip, phoneCountry: ip ? null : eco.settings.defaultCountry, defaultCountry: eco.settings.defaultCountry });
});

/** Market for a viewer outside a web request (bot, cron): their last IP country, else their phone country. */
export async function storedViewerMarket(viewerId: string): Promise<Market> {
  const eco = await loadEconomy();
  const { data } = await db().from("viewers").select("ip_country, country").eq("id", viewerId).maybeSingle();
  return resolveMarket(eco.markets, { ipCountry: data?.ip_country ?? null, phoneCountry: data?.country ?? null, defaultCountry: eco.settings.defaultCountry });
}

export async function viewerFacts(viewerId: string): Promise<ViewerFacts> {
  const [{ data: v }, { count }, { data: used }] = await Promise.all([
    db().from("viewers").select("created_at, last_seen_at").eq("id", viewerId).maybeSingle(),
    db().from("orders").select("id", { count: "exact", head: true }).eq("viewer_id", viewerId).eq("status", "paid"),
    db().from("promotion_redemptions").select("promotion_id").eq("viewer_id", viewerId),
  ]);
  const map: Record<string, number> = {};
  for (const r of used ?? []) map[r.promotion_id] = (map[r.promotion_id] ?? 0) + 1;
  return { joinedAt: v?.created_at ?? new Date().toISOString(), paidOrders: count ?? 0, lastActiveAt: v?.last_seen_at ?? null, used: map };
}

export async function quoteFor(viewerId: string, market: Market, item: PriceItem, code?: string | null): Promise<Quote | null> {
  const eco = await loadEconomy();
  const pack = item.startsWith("pack:") ? eco.packs.find((p) => `pack:${p.id}` === item) : null;
  if (item.startsWith("pack:") && !pack) return null;
  return quote({
    item,
    market,
    prices: priceListFor(eco, market),
    pack: pack ? { coins: pack.coins, bonus: pack.bonus } : null,
    promotions: eco.promotions,
    code,
    viewer: await viewerFacts(viewerId),
    firstPurchaseBonusPct: eco.settings.firstPurchaseBonusPct,
    now: Date.now(),
  });
}

/** Store view: every pack and pass with its price for this viewer (one query for the viewer's facts). */
/** Card prices by country, or the Telegram Stars list for Telegram viewers. */
export function priceListFor(eco: Economy, market: Market): PriceList {
  return isStars(market) ? { [STARS_MARKET.country]: eco.stars } : eco.prices;
}

/** Is this viewer a Telegram viewer ("+tg:<id>")? They pay in Telegram Stars. */
export async function isTelegramViewer(viewerId: string): Promise<boolean> {
  const { data } = await db().from("viewers").select("phone_e164").eq("id", viewerId).maybeSingle();
  return String(data?.phone_e164 ?? "").startsWith("+tg:");
}

/** The market a viewer pays in: Telegram Stars for Telegram viewers, otherwise their country's card prices. */
export async function payingMarket(viewer: { id: string; country: string | null }): Promise<Market> {
  return (await isTelegramViewer(viewer.id)) ? STARS_MARKET : viewerMarket(viewer);
}

export async function storeOffers(viewerId: string, market: Market) {
  const eco = await loadEconomy();
  const facts = await viewerFacts(viewerId);
  const now = Date.now();
  const q = (item: PriceItem, pack?: Pack) =>
    quote({
      item,
      market,
      prices: priceListFor(eco, market),
      pack: pack ? { coins: pack.coins, bonus: pack.bonus } : null,
      promotions: eco.promotions,
      viewer: facts,
      firstPurchaseBonusPct: eco.settings.firstPurchaseBonusPct,
      now,
    });
  const packs = eco.packs.map((p) => ({ pack: p, quote: q(`pack:${p.id}`, p) })).filter((x) => x.quote) as { pack: Pack; quote: Quote }[];
  const banner = eco.promotions.find((p) => p.code === null && (p.bannerAr || p.bannerEn) && quoteBannerApplies(p, facts, market.country, now));
  return {
    market,
    packs,
    weekly: q("weekly"),
    monthly: isStars(market) ? q("monthly") : null, // a Telegram Stars subscription (renews every 30 days)
    yearly: q("yearly"),
    seriesPass: q("series_pass"),
    episodePing: eco.settings.episodePing,
    recurring: eco.settings.recurringEnabled,
    banner: banner ? { ar: banner.bannerAr, en: banner.bannerEn } : null,
    firstPurchase: facts.paidOrders === 0 && eco.settings.firstPurchaseBonusPct > 0 ? eco.settings.firstPurchaseBonusPct : 0,
  };
}

function quoteBannerApplies(p: Promotion, facts: ViewerFacts, country: string, now: number) {
  return promoApplies(p, "pack", facts, country, now) || promoApplies(p, "pass", facts, country, now);
}

/** Is this series shown in the viewer's market? */
export function seriesLicensed(licenseCountries: string[] | null | undefined, market: Market) {
  return licensedIn(licenseCountries, market.country);
}

export { FALLBACK_COUNTRY };
