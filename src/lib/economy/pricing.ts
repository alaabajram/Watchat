// Ping (بينج) economy, pure parts: which market a viewer is priced in, prices, promotions, VAT, daily check-in,
// and invite / partner codes. No database or network: used by checkout, the store, the bot and tests.

export const PING = { ar: "بينج", en: "Ping" } as const;

export type Market = { country: string; currency: string; vatRate: number; active: boolean };
export type PriceItem = `pack:${string}` | "series_pass" | "weekly" | "monthly" | "yearly";
/** country → item → price (VAT included, in the market's currency) */
export type PriceList = Record<string, Partial<Record<PriceItem, number>>>;

export const FALLBACK_COUNTRY = "ZZ"; // everywhere else (international prices)

/**
 * Telegram viewers pay in Telegram Stars (XTR): one price list, no VAT (Telegram sells the Stars). "XS" is a
 * user-assigned code, so it can never clash with a real country.
 */
export const STARS_MARKET: Market = { country: "XS", currency: "XTR", vatRate: 0, active: true };
export const isStars = (m: Market) => m.currency === "XTR";

/** Currencies with 3 decimals (fils / baisa). */
const THREE_DECIMALS = new Set(["KWD", "BHD", "OMR", "JOD"]);
export const decimalsOf = (currency: string) => (currency === "XTR" ? 0 : THREE_DECIMALS.has(currency) ? 3 : 2);
export const roundMoney = (amount: number, currency: string) => {
  const f = 10 ** decimalsOf(currency);
  return Math.round(amount * f) / f;
};

/**
 * The market a viewer is priced and licensed in: the country of their IP when we sell there, otherwise the
 * country of their WhatsApp number, otherwise the international (ZZ) market, otherwise the default country.
 */
export function resolveMarket(markets: Market[], opts: { ipCountry?: string | null; phoneCountry?: string | null; defaultCountry: string }): Market {
  const live = markets.filter((m) => m.active);
  const find = (c?: string | null) => (c ? live.find((m) => m.country === c.toUpperCase()) : undefined);
  return find(opts.ipCountry) ?? find(opts.phoneCountry) ?? find(FALLBACK_COUNTRY) ?? find(opts.defaultCountry) ?? live[0] ?? markets[0];
}

/** Is a series licensed where the viewer is? Empty list = everywhere we sell. */
export function licensedIn(licenseCountries: string[] | null | undefined, country: string): boolean {
  if (!licenseCountries || licenseCountries.length === 0) return true;
  return licenseCountries.includes(country);
}

export const vatOf = (amount: number, rate: number, currency: string) => roundMoney(amount - amount / (1 + rate), currency);

// ---------------------------------------------------------------------------
// Promotions
// ---------------------------------------------------------------------------

export type Promotion = {
  id: string;
  name: string;
  kind: "bonus_ping" | "discount" | "free_ping";
  value: number;
  appliesTo: "packs" | "passes" | "all";
  code: string | null;
  audience: "everyone" | "new" | "first_purchase" | "lapsed";
  countries: string[];
  startsAt: string | null;
  endsAt: string | null;
  maxRedemptions: number | null;
  perViewer: number;
  redemptions: number;
  bannerAr: string | null;
  bannerEn: string | null;
  active: boolean;
};

export type ViewerFacts = {
  joinedAt: string;
  paidOrders: number;
  lastActiveAt: string | null;
  /** How many times this viewer already used each promotion. */
  used: Record<string, number>;
};

export const NEW_VIEWER_DAYS = 7;
export const LAPSED_DAYS = 14;

/** Can this viewer use this promotion on this kind of item, here and now? */
export function promoApplies(p: Promotion, item: "pack" | "pass" | "code", v: ViewerFacts, country: string, now: number): boolean {
  if (!p.active) return false;
  if (p.startsAt && now < Date.parse(p.startsAt)) return false;
  if (p.endsAt && now > Date.parse(p.endsAt)) return false;
  if (p.maxRedemptions !== null && p.redemptions >= p.maxRedemptions) return false;
  if ((v.used[p.id] ?? 0) >= p.perViewer) return false;
  if (p.countries.length && !p.countries.includes(country)) return false;
  if (item === "code") return p.kind === "free_ping";
  if (p.kind === "free_ping") return false;
  if (p.kind === "bonus_ping" && item !== "pack") return false; // bonus Ping only makes sense on packs
  if (p.appliesTo === "packs" && item !== "pack") return false;
  if (p.appliesTo === "passes" && item !== "pass") return false;
  switch (p.audience) {
    case "new":
      return now - Date.parse(v.joinedAt) <= NEW_VIEWER_DAYS * 86400_000;
    case "first_purchase":
      return v.paidOrders === 0;
    case "lapsed":
      return v.lastActiveAt !== null && now - Date.parse(v.lastActiveAt) >= LAPSED_DAYS * 86400_000;
    default:
      return true;
  }
}

export type Quote = {
  item: PriceItem;
  currency: string;
  listPrice: number;
  price: number; // what the viewer pays (VAT included)
  vat: number;
  ping: number; // Ping in the pack (packs only)
  bonusPing: number; // extra Ping from a promotion or the first-purchase bonus
  promotion: Promotion | null;
  firstPurchaseBonus: boolean;
};

/**
 * Price an item for a viewer: the market price, then the single best promotion (an entered code wins over
 * automatic ones), then the first-purchase bonus on packs when no bonus promotion applied. Never stacks discounts.
 */
export function quote(opts: {
  item: PriceItem;
  market: Market;
  prices: PriceList;
  pack?: { coins: number; bonus: number } | null;
  promotions: Promotion[];
  code?: string | null;
  viewer: ViewerFacts;
  firstPurchaseBonusPct: number;
  now: number;
}): Quote | null {
  const listPrice = opts.prices[opts.market.country]?.[opts.item];
  if (!listPrice) return null;
  const kind = opts.item.startsWith("pack:") ? "pack" : "pass";
  const ping = kind === "pack" ? (opts.pack ? opts.pack.coins + opts.pack.bonus : 0) : 0;
  const eligible = opts.promotions.filter((p) => promoApplies(p, kind, opts.viewer, opts.market.country, opts.now));
  const code = opts.code?.trim().toUpperCase() || null;
  const byCode = code ? eligible.find((p) => p.code === code) : undefined;
  const automatic = eligible.filter((p) => p.code === null);
  // Best automatic promotion: the biggest value of its kind; a discount and a bonus compare by viewer value.
  const value = (p: Promotion) => p.value; // % off or % extra Ping: both are worth p.value% of the price
  const promotion = byCode ?? automatic.sort((a, b) => value(b) - value(a))[0] ?? null;

  let price = listPrice;
  let bonusPing = 0;
  if (promotion?.kind === "discount") price = roundMoney(listPrice * (1 - Math.min(promotion.value, 90) / 100), opts.market.currency);
  if (promotion?.kind === "bonus_ping") bonusPing = Math.round((ping * promotion.value) / 100);
  let firstPurchaseBonus = false;
  if (kind === "pack" && bonusPing === 0 && opts.viewer.paidOrders === 0 && opts.firstPurchaseBonusPct > 0) {
    bonusPing = Math.round((ping * opts.firstPurchaseBonusPct) / 100);
    firstPurchaseBonus = bonusPing > 0;
  }
  return {
    item: opts.item,
    currency: opts.market.currency,
    listPrice,
    price,
    vat: vatOf(price, opts.market.vatRate, opts.market.currency),
    ping,
    bonusPing,
    promotion,
    firstPurchaseBonus,
  };
}

// ---------------------------------------------------------------------------
// Daily check-in
// ---------------------------------------------------------------------------

/** The Gulf (UTC+4) calendar day of a moment, as YYYY-MM-DD. */
export const gulfDay = (ms: number) => new Date(ms + 4 * 3600_000).toISOString().slice(0, 10);
const prevDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - 86400_000).toISOString().slice(0, 10);

/**
 * Where the viewer is in the 7-day ladder. A streak continues if they claimed yesterday; after day 7 it starts over.
 * `last` is their most recent claim.
 */
export function checkinState(last: { day: string; streak: number } | null, ladder: number[], now: number) {
  const today = gulfDay(now);
  const steps = ladder.length ? ladder : [1];
  if (last && last.day === today) return { claimedToday: true, streak: last.streak, nextPing: 0, today, ladder: steps };
  const continues = last && last.day === prevDay(today) && last.streak < steps.length;
  const streak = continues ? last!.streak + 1 : 1;
  return { claimedToday: false, streak, nextPing: steps[streak - 1] ?? steps[steps.length - 1], today, ladder: steps };
}

// ---------------------------------------------------------------------------
// Invite and partner codes
// ---------------------------------------------------------------------------

const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // no 0/O, 1/I/L
export function newInviteCode(random: Uint8Array): string {
  return Array.from(random.slice(0, 6), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

/** Invite codes travel as "INV-XXXXXX" and partner codes as "P-CODE" in the first WhatsApp message. */
export function codesIn(text: string): { invite: string | null; partner: string | null } {
  const up = text.toUpperCase();
  const invite = /\bINV-([2-9A-HJ-NP-Z]{6})\b/.exec(up)?.[1] ?? null;
  const partner = /\bP-([A-Z0-9]{3,20})\b/.exec(up)?.[1] ?? null;
  return { invite, partner };
}

/** Commission on a paid order (excluding VAT), in the order's currency. */
export function commissionFor(amount: number, vat: number, pct: number, currency: string): { base: number; commission: number } {
  const base = roundMoney(Math.max(0, amount - vat), currency);
  return { base, commission: roundMoney((base * pct) / 100, currency) };
}

// ---------------------------------------------------------------------------
// Pass renewals
// ---------------------------------------------------------------------------

export const RETRY_AFTER_MS = 24 * 60 * 60 * 1000;
export const MAX_RENEW_ATTEMPTS = 3;

/** After a failed renewal: retry the next day, and stop (pass ends, auto-renew off) after the last attempt. */
export function afterFailedAttempt(attempts: number, now: number) {
  const next = attempts + 1;
  if (next >= MAX_RENEW_ATTEMPTS) return { renew_attempts: next, status: "expired" as const, auto_renew: false, next_attempt_at: null };
  return { renew_attempts: next, status: "past_due" as const, next_attempt_at: new Date(now + RETRY_AFTER_MS).toISOString() };
}
