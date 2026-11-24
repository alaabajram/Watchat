// Wallet: balance, history, coin unlocks and paid orders. Every money change runs inside a Postgres
// function (unlock_episode, fulfil_order, grant_coins) so it is atomic and the ledger stays append-only.

import { siteUrl } from "./site/store";
import { env } from "./env";
import { trackEvent } from "./events";
import { createCharge, getCharge } from "./payments/tap";
import { afterPaid } from "./economy/rewards";
import { economySettings, payingMarket, quoteFor, seriesLicensed, storedViewerMarket } from "./economy/store";
import { createStarsInvoice } from "./telegram/payments";
import type { PriceItem } from "./economy/pricing";
import type { TapCharge } from "./payments/tap";
import { db } from "./supabase";

export async function getBalance(viewerId: string): Promise<number> {
  const { data, error } = await db().rpc("wallet_balance", { p_viewer: viewerId });
  if (error) throw new Error(`wallet_balance failed: ${error.message}`);
  return Number(data ?? 0);
}

export async function getHistory(viewerId: string, limit = 50) {
  const { data } = await db()
    .from("wallet_ledger")
    .select("id, delta, reason, ref_type, ref_id, created_at")
    .eq("viewer_id", viewerId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

export type UnlockResult = "ok" | "already" | "insufficient";

export async function unlockEpisode(viewerId: string, seriesId: string, episode: number, price: number): Promise<UnlockResult> {
  const { data, error } = await db().rpc("unlock_episode", {
    p_viewer: viewerId,
    p_series: seriesId,
    p_episode: episode,
    p_price: price,
  });
  if (error) throw new Error(`unlock_episode failed: ${error.message}`);
  return data as UnlockResult;
}

export type CheckoutItem =
  | { type: "coin_pack"; packId: string }
  | { type: "season_pass"; seriesId: string }
  | { type: "subscription"; plan: "weekly" | "monthly" | "yearly" };

/** "tap" when online payments are configured, otherwise manual cash / transfer approval. */
export function paymentMode(): "tap" | "cash" {
  return process.env.TAP_SECRET_KEY ? "tap" : "cash";
}

type Priced = {
  amount: number;
  listAmount: number;
  currency: string;
  country: string;
  description: string;
  itemRef: string;
  vat: number;
  bonusPing: number;
  promotionId: string | null;
};

/**
 * Price an item from the database for this viewer: their market (IP country → phone country → international),
 * that market's price list, the best promotion (or the code they entered) and the first-purchase bonus.
 * Never trusts the browser. Series passes are only sold where the series is licensed.
 */
async function priceItem(viewer: { id: string; country: string | null }, item: CheckoutItem, code?: string | null): Promise<Priced> {
  const market = await payingMarket(viewer); // Telegram viewers pay in Stars
  let priceKey: PriceItem;
  let description: string;
  let itemRef: string;
  if (item.type === "coin_pack") {
    priceKey = `pack:${item.packId}`;
    itemRef = item.packId;
    description = "Watchat Ping";
  } else if (item.type === "season_pass") {
    const { data: series } = await db().from("series").select("id, title_en, status, license_countries").eq("id", item.seriesId).maybeSingle();
    if (!series || series.status !== "live" || !seriesLicensed(series.license_countries, market.currency === "XTR" ? await storedViewerMarket(viewer.id) : market)) throw new Error("No series pass for this series.");
    priceKey = "series_pass";
    itemRef = series.id;
    description = `Watchat series pass · ${series.title_en}`;
  } else {
    priceKey = item.plan;
    itemRef = item.plan;
    description = item.plan === "weekly" ? "Watchat weekly pass" : item.plan === "monthly" ? "Watchat monthly pass" : "Watchat yearly pass";
  }
  const q = await quoteFor(viewer.id, market, priceKey, code);
  if (!q) throw new Error("This item is not on sale in your country.");
  if (item.type === "coin_pack") description = `Watchat ${q.ping + q.bonusPing} Ping`;
  return {
    amount: q.price,
    listAmount: q.listPrice,
    currency: q.currency,
    country: market.country,
    description,
    itemRef,
    vat: q.vat,
    bonusPing: q.bonusPing,
    promotionId: q.promotion?.id ?? null,
  };
}

function orderRow(viewerId: string, item: CheckoutItem, p: Priced, extra: Record<string, unknown>) {
  return {
    viewer_id: viewerId,
    item_type: item.type,
    item_ref: p.itemRef,
    amount: p.amount,
    list_amount: p.listAmount,
    currency: p.currency,
    country: p.country,
    vat_amount: p.vat,
    bonus_ping: p.bonusPing,
    promotion_id: p.promotionId,
    ...extra,
  };
}

const REF_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // no 0/O, 1/I/L
function newReference(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return `WC-${Array.from(bytes, (b) => REF_ALPHABET[b % REF_ALPHABET.length]).join("")}`;
}

export const MAX_PENDING_CASH_ORDERS = 3;

/** Manual payment: record the order as pending with a short reference the team matches to the payment. */
export async function startCashOrder(params: { viewerId: string; country: string | null; item: CheckoutItem; code?: string | null }) {
  const { count } = await db()
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("viewer_id", params.viewerId)
    .eq("gateway", "cash")
    .eq("status", "pending");
  if ((count ?? 0) >= MAX_PENDING_CASH_ORDERS) throw new Error("too_many_pending");

  const priced = await priceItem({ id: params.viewerId, country: params.country }, params.item, params.code);
  for (let attempt = 0; attempt < 5; attempt++) {
    const reference = newReference();
    const { data, error } = await db()
      .from("orders")
      .insert(orderRow(params.viewerId, params.item, priced, { gateway: "cash", payment_ref: reference, note: priced.description }))
      .select("id")
      .single();
    if (!error && data) return { orderId: data.id as string, reference, amount: priced.amount, currency: priced.currency };
    if (error?.code !== "23505") throw new Error(`order failed: ${error?.message}`);
  }
  throw new Error("Could not create a unique reference.");
}

/** Admin: mark a cash order as paid. Adds the coins / season pass exactly once. */
export async function approveCashOrder(orderId: string, adminId: string, note: string | null): Promise<"ok" | "already"> {
  const { data: order } = await db().from("orders").select("id, viewer_id, gateway, status, item_type, amount, currency").eq("id", orderId).maybeSingle();
  if (!order || order.gateway !== "cash") throw new Error("Order not found.");
  if (order.status === "cancelled" || order.status === "failed") throw new Error("This order was cancelled.");
  const { data, error } = await db().rpc("fulfil_order", { p_order: orderId, p_charge_id: `cash:${adminId}` });
  if (error) throw new Error(`fulfil_order failed: ${error.message}`);
  await db().from("orders").update({ decided_by: adminId, decided_at: new Date().toISOString(), ...(note ? { note } : {}) }).eq("id", orderId);
  if (data === "ok") {
    await afterPaid(orderId).catch((e) => console.error("[rewards] after paid", e));
    const { data: viewer } = await db().from("viewers").select("phone_hmac").eq("id", order.viewer_id).single();
    await trackEvent({
      viewerHmac: viewer?.phone_hmac ?? null,
      name: "order_paid",
      props: { order_id: orderId, item: order.item_type, amount: Number(order.amount), currency: order.currency, method: "cash" },
    });
  }
  return data as "ok" | "already";
}

/** Admin: cancel a pending cash order (nothing is credited). */
export async function cancelCashOrder(orderId: string, adminId: string, note: string | null): Promise<void> {
  await db()
    .from("orders")
    .update({ status: "failed", decided_by: adminId, decided_at: new Date().toISOString(), ...(note ? { note } : {}) })
    .eq("id", orderId)
    .eq("gateway", "cash")
    .eq("status", "pending");
}

/** Create an order at our own price and start a Tap hosted checkout. Returns the URL to send the viewer to. */
/**
 * Telegram viewers: a Stars order and a link to Telegram's payment sheet (the store opens it with openInvoice).
 * The monthly pass is a Stars subscription. Fulfilled by the Telegram webhook (telegram/payments.ts).
 */
export async function startStarsCheckout(params: { viewerId: string; item: CheckoutItem; code?: string | null }): Promise<{ invoice: string; orderId: string }> {
  const priced = await priceItem({ id: params.viewerId, country: null }, params.item, params.code);
  if (priced.currency !== "XTR") throw new Error("not a Telegram viewer");
  const monthly = params.item.type === "subscription" && params.item.plan === "monthly";
  const { data: order, error } = await db()
    .from("orders")
    .insert(orderRow(params.viewerId, params.item, priced, { gateway: "telegram", save_card: monthly }))
    .select("id")
    .single();
  if (error || !order) throw new Error(`order failed: ${error?.message}`);
  const invoice = await createStarsInvoice({
    orderId: order.id,
    stars: priced.amount,
    title: priced.description,
    description: monthly ? "Every series, renews every 30 days · كل المسلسلات، تتجدد كل 30 يوم" : "Watchat · واتشات",
    monthly,
  });
  return { invoice, orderId: order.id };
}

export async function startCheckout(params: {
  viewerId: string;
  country: string | null;
  item: CheckoutItem;
  returnTo: string;
  code?: string | null;
}): Promise<{ url: string; orderId: string }> {
  const priced = await priceItem({ id: params.viewerId, country: params.country }, params.item, params.code);
  const { amount, currency, description } = priced;
  // Weekly / yearly passes save the card for automatic renewal once Tap's Save Card is on for the account.
  const saveCard = params.item.type === "subscription" && (await economySettings()).recurringEnabled;

  const { data: order, error } = await db()
    .from("orders")
    .insert(orderRow(params.viewerId, params.item, priced, { gateway: "tap", save_card: saveCard }))
    .select("id")
    .single();
  if (error || !order) throw new Error(`order failed: ${error?.message}`);

  const { data: viewer } = await db().from("viewers").select("phone_e164").eq("id", params.viewerId).single();
  const digits = (viewer?.phone_e164 ?? "").replace(/\D/g, "");
  const cc = ["971", "966", "965", "974", "973", "968"].find((p) => digits.startsWith(p)) ?? digits.slice(0, 3);

  const base = await siteUrl();
  const charge = await createCharge({
    orderId: order.id,
    amount,
    currency,
    description,
    // Email-only viewers ("+em:…") have no phone: Tap gets a no-reply address on our domain.
    phone: digits.length >= 8 && !String(viewer?.phone_e164 ?? "").startsWith("+em:") ? { countryCode: cc, number: digits.slice(cc.length) } : null,
    fallbackEmail: `viewer-${params.viewerId.slice(0, 8)}@${new URL(base).hostname}`,
    redirectUrl: `${base}/payment/return?order=${order.id}&back=${encodeURIComponent(params.returnTo)}`,
    webhookUrl: `${base}/api/payments/tap`,
    saveCard,
  });
  const url = charge.transaction?.url;
  if (!url) throw new Error("Tap returned no checkout URL.");
  await db().from("orders").update({ gateway_charge_id: charge.id, checkout_url: url }).eq("id", order.id);
  return { url, orderId: order.id };
}

export type PaymentOutcome = "paid" | "already" | "failed" | "pending" | "unknown";

const FAILED_STATUSES = new Set(["FAILED", "DECLINED", "CANCELLED", "ABANDONED", "RESTRICTED", "VOID", "TIMEDOUT", "UNKNOWN"]);

/** Re-read a charge from Tap and fulfil its order if it is captured and matches what we charged. */
export async function verifyAndFulfil(chargeId: string): Promise<{ outcome: PaymentOutcome; orderId?: string }> {
  const charge = await getCharge(chargeId);
  if (!charge) return { outcome: "unknown" };
  const orderId = charge.reference?.order ?? charge.metadata?.order_id;
  if (!orderId) return { outcome: "unknown" };

  const { data: order } = await db()
    .from("orders")
    .select("id, viewer_id, amount, currency, status, item_type, save_card")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return { outcome: "unknown" };
  if (order.status === "paid") return { outcome: "already", orderId };

  if (charge.status === "CAPTURED") {
    const amountOk = Math.abs(Number(order.amount) - Number(charge.amount)) < 0.01;
    if (!amountOk || charge.currency !== order.currency) {
      console.error("[payments] amount/currency mismatch", { orderId, chargeId });
      return { outcome: "failed", orderId };
    }
    const { data, error } = await db().rpc("fulfil_order", { p_order: orderId, p_charge_id: chargeId });
    if (error) throw new Error(`fulfil_order failed: ${error.message}`);
    const { data: viewer } = await db().from("viewers").select("phone_hmac").eq("id", order.viewer_id).single();
    if (data === "ok") {
      if (order.item_type === "subscription" && order.save_card) await rememberCard(orderId, charge);
      await afterPaid(orderId).catch((e) => console.error("[rewards] after paid", e));
      await trackEvent({
        viewerHmac: viewer?.phone_hmac ?? null,
        name: "order_paid",
        props: { order_id: orderId, item: order.item_type, amount: Number(order.amount), currency: order.currency, method: "tap" },
      });
    }
    return { outcome: data === "ok" ? "paid" : "already", orderId };
  }

  if (FAILED_STATUSES.has(charge.status)) {
    await db().from("orders").update({ status: "failed", gateway_charge_id: chargeId }).eq("id", orderId).eq("status", "pending");
    return { outcome: "failed", orderId };
  }
  return { outcome: "pending", orderId };
}

/** Keep the saved card on the pass so it can renew (Tap: card id + customer id + payment agreement). */
async function rememberCard(orderId: string, charge: TapCharge) {
  const { data: o } = await db().from("orders").select("subscription_id").eq("id", orderId).single();
  if (!o?.subscription_id || !charge.card?.id || !charge.customer?.id || !charge.payment_agreement?.id) {
    if (o?.subscription_id) await db().from("subscriptions").update({ auto_renew: false }).eq("id", o.subscription_id); // nothing to renew with
    return;
  }
  await db()
    .from("subscriptions")
    .update({
      tap_customer_id: charge.customer.id,
      tap_card_id: charge.card.id,
      tap_agreement_id: charge.payment_agreement.id,
      card_last4: charge.card.last_four ?? null,
      auto_renew: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", o.subscription_id);
}
