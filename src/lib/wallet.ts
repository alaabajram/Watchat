// Wallet: balance, history, coin unlocks and paid orders. Every money change runs inside a Postgres
// function (unlock_episode, fulfil_order, grant_coins) so it is atomic and the ledger stays append-only.

import { siteUrl } from "./site/store";
import { env } from "./env";
import { trackEvent } from "./events";
import { createCharge, getCharge } from "./payments/tap";
import { currencyFor } from "./phone";
import { db } from "./supabase";

export const VAT_RATE: Record<"AED" | "SAR", number> = { AED: 0.05, SAR: 0.15 };

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

export type CheckoutItem = { type: "coin_pack"; packId: string } | { type: "season_pass"; seriesId: string };

/** "tap" when online payments are configured, otherwise manual cash / transfer approval. */
export function paymentMode(): "tap" | "cash" {
  return process.env.TAP_SECRET_KEY ? "tap" : "cash";
}

type Priced = { amount: number; currency: "AED" | "SAR"; description: string; itemRef: string; vat: number };

/** Price an item from the database in the viewer's currency (VAT included). Never trusts the browser. */
async function priceItem(country: string | null, item: CheckoutItem): Promise<Priced> {
  const currency = currencyFor(country);
  let amount: number;
  let description: string;
  let itemRef: string;
  if (item.type === "coin_pack") {
    const { data: pack } = await db()
      .from("coin_packs")
      .select("id, coins, bonus_coins, price_aed, price_sar, active")
      .eq("id", item.packId)
      .maybeSingle();
    if (!pack || !pack.active) throw new Error("This coin pack is not available.");
    amount = Number(currency === "SAR" ? pack.price_sar : pack.price_aed);
    description = `Watchat ${pack.coins + pack.bonus_coins} coins`;
    itemRef = pack.id;
  } else {
    const { data: series } = await db()
      .from("series")
      .select("id, title_en, season_pass_price_aed, season_pass_price_sar, status")
      .eq("id", item.seriesId)
      .maybeSingle();
    const price = currency === "SAR" ? series?.season_pass_price_sar : series?.season_pass_price_aed;
    if (!series || series.status !== "live" || price === null || price === undefined) throw new Error("No season pass for this series.");
    amount = Number(price);
    description = `Watchat season pass · ${series.title_en}`;
    itemRef = series.id;
  }
  const vat = Math.round((amount - amount / (1 + VAT_RATE[currency])) * 100) / 100;
  return { amount, currency, description, itemRef, vat };
}

const REF_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // no 0/O, 1/I/L
function newReference(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return `WC-${Array.from(bytes, (b) => REF_ALPHABET[b % REF_ALPHABET.length]).join("")}`;
}

export const MAX_PENDING_CASH_ORDERS = 3;

/** Manual payment: record the order as pending with a short reference the team matches to the payment. */
export async function startCashOrder(params: { viewerId: string; country: string | null; item: CheckoutItem }) {
  const { count } = await db()
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("viewer_id", params.viewerId)
    .eq("gateway", "cash")
    .eq("status", "pending");
  if ((count ?? 0) >= MAX_PENDING_CASH_ORDERS) throw new Error("too_many_pending");

  const priced = await priceItem(params.country, params.item);
  for (let attempt = 0; attempt < 5; attempt++) {
    const reference = newReference();
    const { data, error } = await db()
      .from("orders")
      .insert({
        viewer_id: params.viewerId,
        item_type: params.item.type,
        item_ref: priced.itemRef,
        amount: priced.amount,
        currency: priced.currency,
        vat_amount: priced.vat,
        gateway: "cash",
        payment_ref: reference,
        note: priced.description,
      })
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
export async function startCheckout(params: {
  viewerId: string;
  country: string | null;
  item: CheckoutItem;
  returnTo: string;
}): Promise<{ url: string; orderId: string }> {
  const { amount, currency, description, itemRef, vat } = await priceItem(params.country, params.item);

  const { data: order, error } = await db()
    .from("orders")
    .insert({
      viewer_id: params.viewerId,
      item_type: params.item.type,
      item_ref: itemRef,
      amount,
      currency,
      vat_amount: vat,
      gateway: "tap",
    })
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
    phone: { countryCode: cc, number: digits.slice(cc.length) },
    redirectUrl: `${base}/payment/return?order=${order.id}&back=${encodeURIComponent(params.returnTo)}`,
    webhookUrl: `${base}/api/payments/tap`,
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
    .select("id, viewer_id, amount, currency, status, item_type")
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
