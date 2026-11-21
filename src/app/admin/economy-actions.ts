"use server";

// Admin → Pricing & Ping (episode price, markets, price grid, Ping packs, auto-renew) and
// Admin → Offers & promotions (rewards, promotions, invites, partners and their commissions).

import { revalidatePath } from "next/cache";
import { audit, requireAdmin } from "@/lib/admin/auth";
import { bool, done, int, num, opt, str, uuid } from "@/lib/admin/forms";
import { db } from "@/lib/supabase";

const PRICING = "/admin/pricing";
const OFFERS = "/admin/offers";
const COUNTRY = /^[A-Z]{2}$/;
const CURRENCY = /^[A-Z]{3}$/;

// ---------------------------------------------------------------------------
// Pricing & Ping
// ---------------------------------------------------------------------------

export async function savePricingSettingsAction(fd: FormData) {
  const admin = await requireAdmin("pricing");
  const episodePing = int(fd, "episode_ping", 10);
  const defaultCountry = str(fd, "default_country", 2).toUpperCase();
  if (episodePing < 1 || episodePing > 10000) done(PRICING, "Episode price must be 1–10,000 Ping.", "err");
  if (!COUNTRY.test(defaultCountry)) done(PRICING, "Pick a default country.", "err");
  const row = { episode_ping: episodePing, default_country: defaultCountry, recurring_enabled: bool(fd, "recurring_enabled"), updated_at: new Date().toISOString() };
  const { error } = await db().from("economy_settings").upsert({ tenant_id: admin.tenantId, ...row });
  if (error) done(PRICING, `Save failed: ${error.message}`, "err");
  // Optionally move every series (and clear per-episode overrides) to the new episode price.
  if (bool(fd, "apply_all")) {
    await db().from("series").update({ coins_per_episode: episodePing }).eq("tenant_id", admin.tenantId);
  }
  await audit(admin, "economy.pricing_saved", "economy", null, { ...row, apply_all: bool(fd, "apply_all") });
  revalidatePath("/store");
  done(PRICING, "Pricing settings saved.");
}

export async function saveMarketAction(fd: FormData) {
  const admin = await requireAdmin("pricing");
  const country = str(fd, "country", 2).toUpperCase();
  const currency = str(fd, "currency", 3).toUpperCase();
  const vat = num(fd, "vat_pct");
  if (!COUNTRY.test(country) || !CURRENCY.test(currency)) done(PRICING, "Country (2 letters, ZZ = rest of world) and currency (3 letters) are required.", "err");
  if (vat === null || vat < 0 || vat > 50) done(PRICING, "VAT must be 0–50%.", "err");
  const row = { tenant_id: admin.tenantId, country, currency, vat_rate: vat / 100, active: bool(fd, "active"), sort: int(fd, "sort", 50) };
  const { error } = await db().from("markets").upsert(row);
  if (error) done(PRICING, `Save failed: ${error.message}`, "err");
  await audit(admin, "economy.market_saved", "market", null, row);
  done(PRICING, `Market ${country} saved. Set its prices in the grid below.`);
}

/** The price grid: one input per market × item, named "p:<country>:<item>". Empty = not on sale there. */
export async function savePriceGridAction(fd: FormData) {
  const admin = await requireAdmin("pricing");
  const upserts: { tenant_id: string; country: string; item: string; price: number }[] = [];
  const removals: { country: string; item: string }[] = [];
  for (const [key, raw] of fd.entries()) {
    const m = /^p:([A-Z]{2}):(pack:[0-9a-f-]{36}|series_pass|weekly|yearly)$/.exec(key);
    if (!m) continue;
    const v = String(raw).trim();
    if (!v) {
      removals.push({ country: m[1], item: m[2] });
      continue;
    }
    const price = Number(v);
    if (!Number.isFinite(price) || price <= 0 || price > 100000) done(PRICING, `Bad price for ${m[1]} · ${m[2]}.`, "err");
    upserts.push({ tenant_id: admin.tenantId, country: m[1], item: m[2], price });
  }
  if (upserts.length) {
    const { error } = await db().from("market_prices").upsert(upserts);
    if (error) done(PRICING, `Save failed: ${error.message}`, "err");
  }
  for (const r of removals) {
    await db().from("market_prices").delete().eq("tenant_id", admin.tenantId).eq("country", r.country).eq("item", r.item);
  }
  await audit(admin, "economy.prices_saved", "market_prices", null, { prices: upserts.length, removed: removals.length });
  revalidatePath("/store");
  done(PRICING, `Prices saved (${upserts.length}).`);
}

export async function savePingPackAction(fd: FormData) {
  const admin = await requireAdmin("pricing");
  const id = uuid(fd, "id");
  const coins = int(fd, "coins", 0);
  if (coins < 1 || coins > 1_000_000) done(PRICING, "Ping must be 1 or more.", "err");
  const row = {
    coins,
    bonus_coins: Math.max(0, int(fd, "bonus_coins", 0)),
    sort: int(fd, "sort", 0),
    active: bool(fd, "active"),
    label_ar: opt(fd, "label_ar", 40),
    label_en: opt(fd, "label_en", 40),
  };
  const { data, error } = id
    ? await db().from("coin_packs").update(row).eq("id", id).eq("tenant_id", admin.tenantId).select("id").single()
    : await db().from("coin_packs").insert({ ...row, tenant_id: admin.tenantId }).select("id").single();
  if (error || !data) done(PRICING, `Save failed: ${error?.message}`, "err");
  await audit(admin, id ? "pack.updated" : "pack.created", "coin_pack", data.id, row);
  done(PRICING, id ? "Ping pack saved." : "Ping pack added. Set its price in each market in the grid.");
}

// ---------------------------------------------------------------------------
// Offers & promotions: rewards
// ---------------------------------------------------------------------------

export async function saveRewardSettingsAction(fd: FormData) {
  const admin = await requireAdmin("offers");
  const ladder = str(fd, "checkin_ladder", 200)
    .split(/[,\s،]+/)
    .filter(Boolean)
    .map((x) => Number.parseInt(x, 10));
  if (ladder.length < 1 || ladder.length > 14 || ladder.some((n) => !Number.isFinite(n) || n < 0 || n > 1000)) {
    done(OFFERS, "Check-in: 1–14 days, each 0–1,000 Ping, separated by commas.", "err");
  }
  const row = {
    welcome_ping: clamp(int(fd, "welcome_ping", 50), 0, 10000),
    checkin_ladder: ladder,
    first_purchase_bonus_pct: clamp(int(fd, "first_purchase_bonus_pct", 0), 0, 300),
    referral_friend_ping: clamp(int(fd, "referral_friend_ping", 0), 0, 10000),
    referral_referrer_ping: clamp(int(fd, "referral_referrer_ping", 0), 0, 10000),
    referral_monthly_cap: clamp(int(fd, "referral_monthly_cap", 20), 0, 1000),
    updated_at: new Date().toISOString(),
  };
  const { error } = await db().from("economy_settings").upsert({ tenant_id: admin.tenantId, ...row });
  if (error) done(OFFERS, `Save failed: ${error.message}`, "err");
  await audit(admin, "economy.rewards_saved", "economy", null, row);
  done(OFFERS, "Reward settings saved.");
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// ---------------------------------------------------------------------------
// Promotions
// ---------------------------------------------------------------------------

export async function savePromotionAction(fd: FormData) {
  const admin = await requireAdmin("offers");
  const id = uuid(fd, "id");
  const kind = str(fd, "kind", 20);
  const appliesTo = str(fd, "applies_to", 10) || "packs";
  const audience = str(fd, "audience", 20) || "everyone";
  const code = str(fd, "code", 20).toUpperCase() || null;
  const value = int(fd, "value", 0);
  const name = str(fd, "name", 80);
  if (!name) done(OFFERS, "Give the promotion a name.", "err");
  if (!["bonus_ping", "discount", "free_ping"].includes(kind)) done(OFFERS, "Pick a promotion type.", "err");
  if (!["packs", "passes", "all"].includes(appliesTo) || !["everyone", "new", "first_purchase", "lapsed"].includes(audience)) done(OFFERS, "Bad request.", "err");
  if (code && !/^[A-Z0-9]{3,20}$/.test(code)) done(OFFERS, "Codes are 3–20 letters or digits.", "err");
  if (kind === "free_ping" && !code) done(OFFERS, "Free Ping needs a code viewers type in the store.", "err");
  if (kind === "discount" && (value < 1 || value > 90)) done(OFFERS, "Discounts are 1–90%.", "err");
  if (kind === "bonus_ping" && (value < 1 || value > 300)) done(OFFERS, "Bonus Ping is 1–300%.", "err");
  if (kind === "free_ping" && (value < 1 || value > 10000)) done(OFFERS, "Free Ping is 1–10,000.", "err");
  const countries = fd
    .getAll("countries")
    .map((c) => String(c).toUpperCase())
    .filter((c) => COUNTRY.test(c));
  const maxRed = int(fd, "max_redemptions", 0);
  const row = {
    name,
    kind,
    value,
    applies_to: kind === "bonus_ping" ? "packs" : appliesTo,
    code,
    audience,
    countries,
    starts_at: dateOrNull(str(fd, "starts_at", 30)),
    ends_at: dateOrNull(str(fd, "ends_at", 30)),
    max_redemptions: maxRed > 0 ? maxRed : null,
    per_viewer: clamp(int(fd, "per_viewer", 1), 1, 100),
    banner_ar: opt(fd, "banner_ar", 140),
    banner_en: opt(fd, "banner_en", 140),
    active: bool(fd, "active"),
  };
  const { error } = id
    ? await db().from("promotions").update(row).eq("id", id).eq("tenant_id", admin.tenantId)
    : await db().from("promotions").insert({ ...row, tenant_id: admin.tenantId });
  if (error) done(OFFERS, error.code === "23505" ? "That code is already used by another promotion." : `Save failed: ${error.message}`, "err");
  await audit(admin, id ? "promotion.updated" : "promotion.created", "promotion", id, row);
  revalidatePath("/store");
  done(OFFERS, "Promotion saved.");
}

function dateOrNull(v: string): string | null {
  if (!v) return null;
  const ms = Date.parse(v.length === 16 ? `${v}:00+04:00` : v); // datetime-local is Gulf time
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

// ---------------------------------------------------------------------------
// Partners (affiliates)
// ---------------------------------------------------------------------------

export async function saveAffiliateAction(fd: FormData) {
  const admin = await requireAdmin("offers");
  const id = uuid(fd, "id");
  const code = str(fd, "code", 20).toUpperCase();
  const name = str(fd, "name", 80);
  const pct = num(fd, "commission_pct");
  if (!name || !/^[A-Z0-9]{3,20}$/.test(code)) done(OFFERS, "Partners need a name and a 3–20 letter/digit code.", "err");
  if (pct === null || pct < 0 || pct > 90) done(OFFERS, "Commission is 0–90%.", "err");
  const row = {
    name,
    code,
    commission_pct: pct,
    window_days: clamp(int(fd, "window_days", 90), 1, 3650),
    contact: opt(fd, "contact", 120),
    notes: opt(fd, "notes", 500),
    active: bool(fd, "active"),
  };
  const { error } = id
    ? await db().from("affiliates").update(row).eq("id", id).eq("tenant_id", admin.tenantId)
    : await db().from("affiliates").insert({ ...row, tenant_id: admin.tenantId });
  if (error) done(OFFERS, error.code === "23505" ? "That partner code is taken." : `Save failed: ${error.message}`, "err");
  await audit(admin, id ? "affiliate.updated" : "affiliate.created", "affiliate", id, row);
  done(OFFERS, "Partner saved.");
}

/** Finance: approve pending commissions (after the refund window) or mark approved ones paid. */
export async function settleCommissionsAction(fd: FormData) {
  const admin = await requireAdmin("orders");
  const id = uuid(fd, "affiliate_id");
  const to = str(fd, "to", 10);
  if (!id || !["approved", "paid"].includes(to)) done(OFFERS, "Bad request.", "err");
  const from = to === "approved" ? "pending" : "approved";
  const patch = to === "paid" ? { status: "paid", paid_at: new Date().toISOString() } : { status: "approved" };
  const { data, error } = await db()
    .from("affiliate_commissions")
    .update(patch)
    .eq("tenant_id", admin.tenantId)
    .eq("affiliate_id", id)
    .eq("status", from)
    .select("id");
  if (error) done(OFFERS, `Update failed: ${error.message}`, "err");
  await audit(admin, `commissions.${to}`, "affiliate", id, { count: data?.length ?? 0 });
  done(OFFERS, `${data?.length ?? 0} commission(s) marked ${to}.`);
}

/** Licensing: the countries a series may be shown in (none ticked = every market). */
export async function saveLicenseAction(fd: FormData) {
  const admin = await requireAdmin("content");
  const id = uuid(fd, "id");
  if (!id) done("/admin/series", "Bad request.", "err");
  const countries = [...new Set(fd.getAll("license").map((c) => String(c).toUpperCase()).filter((c) => COUNTRY.test(c)))];
  const { error } = await db().from("series").update({ license_countries: countries }).eq("id", id).eq("tenant_id", admin.tenantId);
  if (error) done(`/admin/series/${id}`, `Save failed: ${error.message}`, "err");
  await audit(admin, "series.license_saved", "series", id, { countries });
  done(`/admin/series/${id}`, countries.length ? `Licensed in ${countries.join(", ")}.` : "Licensed in every market.");
}
