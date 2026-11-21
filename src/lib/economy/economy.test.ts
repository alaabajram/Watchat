import { describe, expect, it } from "vitest";
import {
  afterFailedAttempt,
  MAX_RENEW_ATTEMPTS,
  checkinState,
  codesIn,
  commissionFor,
  decimalsOf,
  gulfDay,
  licensedIn,
  newInviteCode,
  promoApplies,
  quote,
  resolveMarket,
  roundMoney,
  vatOf,
  type Market,
  type PriceList,
  type Promotion,
  type ViewerFacts,
} from "./pricing";
import { formatMoney } from "../web-copy";
import { parseIntent } from "../bot/intents";

const markets: Market[] = [
  { country: "AE", currency: "AED", vatRate: 0.05, active: true },
  { country: "SA", currency: "SAR", vatRate: 0.15, active: true },
  { country: "KW", currency: "KWD", vatRate: 0, active: false },
  { country: "ZZ", currency: "USD", vatRate: 0, active: true },
];
const prices: PriceList = {
  AE: { weekly: 33, yearly: 659, series_pass: 29, "pack:p1": 19 },
  SA: { weekly: 34, "pack:p1": 19 },
  ZZ: { weekly: 9, yearly: 180, "pack:p1": 4.99 },
};
const NOW = Date.parse("2026-11-21T10:00:00Z");
const viewer = (over: Partial<ViewerFacts> = {}): ViewerFacts => ({ joinedAt: "2026-11-20T00:00:00Z", paidOrders: 0, lastActiveAt: "2026-11-21T09:00:00Z", used: {}, ...over });
const promo = (over: Partial<Promotion> = {}): Promotion => ({
  id: "pr1",
  name: "Test",
  kind: "bonus_ping",
  value: 30,
  appliesTo: "packs",
  code: null,
  audience: "everyone",
  countries: [],
  startsAt: null,
  endsAt: null,
  maxRedemptions: null,
  perViewer: 1,
  redemptions: 0,
  bannerAr: null,
  bannerEn: null,
  active: true,
  ...over,
});

describe("markets and geo-fencing", () => {
  it("prices by IP country first, then the phone's country, then international", () => {
    expect(resolveMarket(markets, { ipCountry: "SA", phoneCountry: "AE", defaultCountry: "AE" }).currency).toBe("SAR");
    expect(resolveMarket(markets, { ipCountry: null, phoneCountry: "AE", defaultCountry: "AE" }).currency).toBe("AED");
    expect(resolveMarket(markets, { ipCountry: "US", phoneCountry: null, defaultCountry: "AE" }).country).toBe("ZZ");
    // A market that's switched off falls through to the next one.
    expect(resolveMarket(markets, { ipCountry: "KW", phoneCountry: "AE", defaultCountry: "AE" }).country).toBe("AE");
  });

  it("licensing: empty = everywhere, otherwise only the listed countries", () => {
    expect(licensedIn([], "SA")).toBe(true);
    expect(licensedIn(null, "ZZ")).toBe(true);
    expect(licensedIn(["AE", "SA"], "SA")).toBe(true);
    expect(licensedIn(["AE"], "SA")).toBe(false);
    expect(licensedIn(["AE"], "ZZ")).toBe(false);
    expect(licensedIn(["ZZ"], "ZZ")).toBe(true);
  });

  it("money: currency decimals, VAT included, any currency formats", () => {
    expect(decimalsOf("KWD")).toBe(3);
    expect(roundMoney(1.23456, "KWD")).toBe(1.235);
    expect(roundMoney(1.236, "AED")).toBe(1.24);
    expect(vatOf(105, 0.05, "AED")).toBe(5);
    expect(formatMoney(9, "USD", "en")).toContain("9");
    expect(formatMoney(2.8, "KWD", "en")).toMatch(/2\.8/);
    expect(formatMoney(5, "XXX1" as string, "en")).toBe("5 XXX1");
  });
});

describe("quotes", () => {
  const base = { market: markets[0], prices, pack: { coins: 250, bonus: 0 }, promotions: [] as Promotion[], viewer: viewer(), firstPurchaseBonusPct: 20, now: NOW };

  it("weekly is $9 internationally and the country price at home", () => {
    expect(quote({ ...base, item: "weekly", market: markets[3], pack: null })!.price).toBe(9);
    expect(quote({ ...base, item: "yearly", market: markets[3], pack: null })!.price).toBe(180);
    expect(quote({ ...base, item: "weekly", pack: null })).toMatchObject({ price: 33, currency: "AED", vat: 1.57 });
  });

  it("is null where the item isn't on sale", () => {
    expect(quote({ ...base, item: "yearly", market: markets[1], pack: null })).toBeNull();
  });

  it("first top-up gets the bonus Ping; later ones don't", () => {
    expect(quote({ ...base, item: "pack:p1" })).toMatchObject({ ping: 250, bonusPing: 50, firstPurchaseBonus: true, price: 19 });
    expect(quote({ ...base, item: "pack:p1", viewer: viewer({ paidOrders: 1 }) })).toMatchObject({ bonusPing: 0, firstPurchaseBonus: false });
  });

  it("a bonus promotion replaces the first-purchase bonus instead of stacking", () => {
    const q = quote({ ...base, item: "pack:p1", promotions: [promo({ value: 30 })] })!;
    expect(q.bonusPing).toBe(75);
    expect(q.firstPurchaseBonus).toBe(false);
    expect(q.promotion?.id).toBe("pr1");
  });

  it("discounts lower the price (capped at 90%) and recompute VAT", () => {
    const q = quote({ ...base, item: "weekly", pack: null, promotions: [promo({ kind: "discount", value: 50, appliesTo: "passes" })] })!;
    expect(q.price).toBe(16.5);
    expect(q.listPrice).toBe(33);
    expect(q.vat).toBe(0.79);
  });

  it("an entered code wins over automatic promotions; unknown codes are ignored", () => {
    const auto = promo({ id: "auto", kind: "discount", value: 10, appliesTo: "all" });
    const coded = promo({ id: "code", kind: "discount", value: 25, appliesTo: "all", code: "RAMADAN" });
    expect(quote({ ...base, item: "weekly", pack: null, promotions: [auto, coded], code: "ramadan" })!.promotion?.id).toBe("code");
    expect(quote({ ...base, item: "weekly", pack: null, promotions: [auto, coded], code: "NOPE" })!.promotion?.id).toBe("auto");
    expect(quote({ ...base, item: "weekly", pack: null, promotions: [coded] })!.promotion).toBeNull(); // codes are never automatic
  });
});

describe("promotion rules", () => {
  it("respects dates, limits, countries, per-viewer use and item type", () => {
    const v = viewer();
    expect(promoApplies(promo({ endsAt: "2026-11-01T00:00:00Z" }), "pack", v, "AE", NOW)).toBe(false);
    expect(promoApplies(promo({ startsAt: "2026-12-01T00:00:00Z" }), "pack", v, "AE", NOW)).toBe(false);
    expect(promoApplies(promo({ maxRedemptions: 5, redemptions: 5 }), "pack", v, "AE", NOW)).toBe(false);
    expect(promoApplies(promo({ countries: ["SA"] }), "pack", v, "AE", NOW)).toBe(false);
    expect(promoApplies(promo(), "pack", viewer({ used: { pr1: 1 } }), "AE", NOW)).toBe(false);
    expect(promoApplies(promo(), "pass", v, "AE", NOW)).toBe(false); // bonus Ping is for packs
    expect(promoApplies(promo({ kind: "free_ping", code: "GIFT" }), "code", v, "AE", NOW)).toBe(true);
    expect(promoApplies(promo({ kind: "free_ping", code: "GIFT" }), "pack", v, "AE", NOW)).toBe(false);
  });

  it("targets new, never-bought and lapsed viewers", () => {
    expect(promoApplies(promo({ audience: "new" }), "pack", viewer({ joinedAt: "2026-10-01T00:00:00Z" }), "AE", NOW)).toBe(false);
    expect(promoApplies(promo({ audience: "new" }), "pack", viewer(), "AE", NOW)).toBe(true);
    expect(promoApplies(promo({ audience: "first_purchase" }), "pack", viewer({ paidOrders: 2 }), "AE", NOW)).toBe(false);
    expect(promoApplies(promo({ audience: "lapsed" }), "pack", viewer(), "AE", NOW)).toBe(false);
    expect(promoApplies(promo({ audience: "lapsed" }), "pack", viewer({ lastActiveAt: "2026-10-01T00:00:00Z" }), "AE", NOW)).toBe(true);
  });
});

describe("daily check-in", () => {
  const ladder = [2, 2, 3, 3, 5, 5, 10];
  it("uses the Gulf day", () => {
    expect(gulfDay(Date.parse("2026-11-21T21:00:00Z"))).toBe("2026-11-22");
  });
  it("starts at day 1, continues the next day, resets after a gap or after day 7", () => {
    expect(checkinState(null, ladder, NOW)).toMatchObject({ streak: 1, nextPing: 2, claimedToday: false });
    expect(checkinState({ day: "2026-11-20", streak: 3 }, ladder, NOW)).toMatchObject({ streak: 4, nextPing: 3 });
    expect(checkinState({ day: "2026-11-18", streak: 3 }, ladder, NOW)).toMatchObject({ streak: 1, nextPing: 2 });
    expect(checkinState({ day: "2026-11-20", streak: 6 }, ladder, NOW)).toMatchObject({ streak: 7, nextPing: 10 });
    expect(checkinState({ day: "2026-11-20", streak: 7 }, ladder, NOW)).toMatchObject({ streak: 1 });
    expect(checkinState({ day: "2026-11-21", streak: 2 }, ladder, NOW)).toMatchObject({ claimedToday: true, nextPing: 0 });
  });
});

describe("invites and partners", () => {
  it("invite codes avoid look-alike characters", () => {
    const code = newInviteCode(new Uint8Array([0, 1, 2, 3, 4, 5]));
    expect(code).toMatch(/^[2-9A-HJ-NP-Z]{6}$/);
  });
  it("reads codes from the first WhatsApp message", () => {
    expect(codesIn("أهلاً واتشات 👋 INV-ABC234")).toEqual({ invite: "ABC234", partner: null });
    expect(codesIn("hi p-noor24")).toEqual({ invite: null, partner: "NOOR24" });
    expect(codesIn("SECRETS01")).toEqual({ invite: null, partner: null });
  });
  it("the bot treats a prefilled code as a greeting, or keeps the series code next to it", () => {
    const msg = (text: string) => ({ id: "m", from: "971500000000", timestamp: 0, kind: "text" as const, text });
    expect(parseIntent(msg("أهلاً واتشات 👋 INV-ABC234")).type).toBe("menu");
    expect(parseIntent(msg("P-NOOR24"))).toEqual({ type: "menu" });
    expect(parseIntent(msg("INV-ABC234 SECRETS01"))).toEqual({ type: "series_code", code: "SECRETS01" });
  });
  it("commission is on the amount excluding VAT", () => {
    expect(commissionFor(105, 5, 20, "AED")).toEqual({ base: 100, commission: 20 });
    expect(commissionFor(3.4, 0.309, 15, "BHD")).toEqual({ base: 3.091, commission: 0.464 });
  });
});

describe("pass renewals", () => {
  it("retries daily and gives up after the last attempt", () => {
    expect(afterFailedAttempt(0, NOW)).toMatchObject({ renew_attempts: 1, status: "past_due" });
    expect(afterFailedAttempt(MAX_RENEW_ATTEMPTS - 1, NOW)).toMatchObject({ status: "expired", auto_renew: false });
  });
});
