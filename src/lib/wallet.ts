// Wallet: balance, history, coin unlocks and paid orders. Every money change runs inside a Postgres
// function (unlock_episode, fulfil_order, grant_coins) so it is atomic and the ledger stays append-only.

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

/** Create an order at our own price and start a Tap hosted checkout. Returns the URL to send the viewer to. */
export async function startCheckout(params: {
  viewerId: string;
  country: string | null;
  item: CheckoutItem;
  returnTo: string;
}): Promise<{ url: string; orderId: string }> {
  const currency = currencyFor(params.country);
  let amount: number;
  let description: string;
  let itemRef: string;

  if (params.item.type === "coin_pack") {
    const { data: pack } = await db()
      .from("coin_packs")
      .select("id, coins, bonus_coins, price_aed, price_sar, active")
      .eq("id", params.item.packId)
      .maybeSingle();
    if (!pack || !pack.active) throw new Error("This coin pack is not available.");
    amount = Number(currency === "SAR" ? pack.price_sar : pack.price_aed);
    description = `Watchat ${pack.coins + pack.bonus_coins} coins`;
    itemRef = pack.id;
  } else {
    const { data: series } = await db()
      .from("series")
      .select("id, title_en, season_pass_price_aed, season_pass_price_sar, status")
      .eq("id", params.item.seriesId)
      .maybeSingle();
    const price = currency === "SAR" ? series?.season_pass_price_sar : series?.season_pass_price_aed;
    if (!series || series.status !== "live" || price === null || price === undefined) throw new Error("No season pass for this series.");
    amount = Number(price);
    description = `Watchat season pass · ${series.title_en}`;
    itemRef = series.id;
  }

  const vat = Math.round((amount - amount / (1 + VAT_RATE[currency])) * 100) / 100;
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

  const charge = await createCharge({
    orderId: order.id,
    amount,
    currency,
    description,
    phone: { countryCode: cc, number: digits.slice(cc.length) },
    redirectUrl: `${env.appUrl}/payment/return?order=${order.id}&back=${encodeURIComponent(params.returnTo)}`,
    webhookUrl: `${env.appUrl}/api/payments/tap`,
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
