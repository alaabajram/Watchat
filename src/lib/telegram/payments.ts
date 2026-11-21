// Telegram Stars payments (server). A Telegram viewer's purchase is an order with gateway "telegram" and
// currency XTR (amount = Stars). The store opens Telegram's own payment sheet with an invoice link; Telegram
// asks us to confirm (pre_checkout_query), then sends successful_payment to the webhook, which fulfils the order
// through the same fulfil_order + afterPaid as card payments. The monthly pass is a Stars subscription that
// Telegram renews every 30 days (each renewal arrives as another successful_payment).

import { afterPaid } from "../economy/rewards";
import { trackEvent } from "../events";
import { db } from "../supabase";
import { tgCall } from "./client";

export const STARS_SUBSCRIPTION_PERIOD = 2592000; // 30 days: the only period Telegram allows

const clip = (s: string, max: number) => (Array.from(s).length <= max ? s : Array.from(s).slice(0, max - 1).join("") + "…");

/** A payment link for Telegram's payment sheet (opened from the Mini App with openInvoice). */
export async function createStarsInvoice(o: { orderId: string; stars: number; title: string; description: string; monthly: boolean }): Promise<string> {
  const r = await tgCall<string>("createInvoiceLink", {
    title: clip(o.title, 32),
    description: clip(o.description, 255),
    payload: o.orderId,
    currency: "XTR",
    prices: [{ label: clip(o.title, 32), amount: Math.round(o.stars) }],
    ...(o.monthly ? { subscription_period: STARS_SUBSCRIPTION_PERIOD } : {}),
  });
  if (!r.ok || !r.result) throw new Error(`createInvoiceLink failed: ${r.description ?? "unknown"}`);
  return r.result;
}

type PreCheckout = { id: string; currency: string; total_amount: number; invoice_payload: string };

/** Telegram asks before charging: only a pending Stars order with the same amount may be paid. */
export async function answerPreCheckout(q: PreCheckout): Promise<void> {
  const { data: o } = await db().from("orders").select("status, amount, currency, gateway").eq("id", q.invoice_payload).maybeSingle();
  const ok = Boolean(o && o.gateway === "telegram" && o.currency === "XTR" && o.status === "pending" && Number(o.amount) === q.total_amount);
  await tgCall("answerPreCheckoutQuery", {
    pre_checkout_query_id: q.id,
    ok,
    ...(ok ? {} : { error_message: "هذا الطلب انتهى. ارجع للمتجر وجرّب مرة ثانية · This order expired, please try again from the store." }),
  });
}

export type SuccessfulPayment = {
  currency: string;
  total_amount: number;
  invoice_payload: string;
  telegram_payment_charge_id: string;
  subscription_expiration_date?: number;
  is_recurring?: boolean;
  is_first_recurring?: boolean;
};

/** Fulfil a Stars payment (first payment or a monthly renewal). Exactly once per Telegram charge id. */
export async function fulfilStarsPayment(chatId: number, p: SuccessfulPayment): Promise<"ok" | "already" | "unknown"> {
  if (p.currency !== "XTR") return "unknown";
  const { data: seen } = await db().from("orders").select("id").eq("gateway_charge_id", p.telegram_payment_charge_id).maybeSingle();
  if (seen) return "already";
  const { data: first } = await db()
    .from("orders")
    .select("id, viewer_id, item_type, item_ref, amount, status, subscription_id")
    .eq("id", p.invoice_payload)
    .maybeSingle();
  if (!first) return "unknown";

  let orderId = first.id as string;
  if (first.status === "paid" && p.is_recurring && !p.is_first_recurring) {
    // A monthly renewal: a new order for the new period, so revenue and partner commission count each month.
    const { data: renewal } = await db()
      .from("orders")
      .insert({
        viewer_id: first.viewer_id,
        item_type: "subscription",
        item_ref: first.item_ref,
        amount: p.total_amount,
        list_amount: p.total_amount,
        currency: "XTR",
        country: "XS",
        vat_amount: 0,
        gateway: "telegram",
        is_renewal: true,
        subscription_id: first.subscription_id,
      })
      .select("id")
      .single();
    if (!renewal) return "unknown";
    orderId = renewal.id;
  } else if (first.status !== "pending") {
    return "already";
  }

  const { data, error } = await db().rpc("fulfil_order", { p_order: orderId, p_charge_id: p.telegram_payment_charge_id });
  if (error) throw new Error(`fulfil_order failed: ${error.message}`);
  if (data !== "ok") return "already";

  if (first.item_type === "subscription" && first.item_ref === "monthly") {
    const { data: o } = await db().from("orders").select("subscription_id").eq("id", orderId).single();
    if (o?.subscription_id) {
      await db()
        .from("subscriptions")
        .update({
          tg_charge_id: p.telegram_payment_charge_id,
          tg_user_id: chatId,
          auto_renew: true,
          ...(p.subscription_expiration_date ? { current_period_end: new Date(p.subscription_expiration_date * 1000).toISOString() } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", o.subscription_id);
    }
  }
  await afterPaid(orderId).catch((e) => console.error("[stars] after paid", e));
  const { data: viewer } = await db().from("viewers").select("phone_hmac").eq("id", first.viewer_id).single();
  await trackEvent({
    viewerHmac: viewer?.phone_hmac ?? null,
    name: "order_paid",
    props: { order_id: orderId, item: first.item_type, amount: p.total_amount, currency: "XTR", method: "telegram_stars", renewal: orderId !== first.id },
  });
  return "ok";
}

/** Stop or restart a Stars subscription's renewal (the pass stays until the end of the paid month). */
export async function setStarsRenewal(sub: { tg_user_id: number | null; tg_charge_id: string | null }, on: boolean): Promise<boolean> {
  if (!sub.tg_user_id || !sub.tg_charge_id) return false;
  const r = await tgCall("editUserStarSubscription", { user_id: sub.tg_user_id, telegram_payment_charge_id: sub.tg_charge_id, is_canceled: !on });
  return r.ok;
}

/** Admin: give the Stars back for a paid Telegram order and take back what it gave. */
export async function refundStarsOrder(orderId: string): Promise<{ ok: boolean; error?: string }> {
  const { data: o } = await db()
    .from("orders")
    .select("id, viewer_id, item_type, item_ref, gateway, status, gateway_charge_id, subscription_id, bonus_ping")
    .eq("id", orderId)
    .maybeSingle();
  if (!o || o.gateway !== "telegram" || o.status !== "paid" || !o.gateway_charge_id) return { ok: false, error: "Only paid Telegram Stars orders can be refunded here." };
  const { data: v } = await db().from("viewers").select("phone_e164").eq("id", o.viewer_id).single();
  const userId = Number(String(v?.phone_e164 ?? "").replace(/^\+tg:/, ""));
  if (!userId) return { ok: false, error: "This viewer has no Telegram account." };
  const r = await tgCall("refundStarPayment", { user_id: userId, telegram_payment_charge_id: o.gateway_charge_id });
  if (!r.ok) return { ok: false, error: r.description ?? "Telegram refused the refund." };

  await db().from("orders").update({ status: "refunded" }).eq("id", o.id);
  // Take back what the order gave (append-only ledger: a negative "refund" row).
  if (o.item_type === "coin_pack") {
    const { data: pack } = await db().from("coin_packs").select("coins, bonus_coins").eq("id", o.item_ref).maybeSingle();
    const ping = (pack ? Number(pack.coins) + Number(pack.bonus_coins) : 0) + Number(o.bonus_ping ?? 0);
    if (ping > 0) {
      await db().from("wallet_ledger").insert({ viewer_id: o.viewer_id, delta: -ping, reason: "refund", ref_type: "order", ref_id: o.id, idempotency_key: `refund:${o.id}` });
    }
  } else if (o.item_type === "season_pass") {
    await db().from("entitlements").delete().eq("viewer_id", o.viewer_id).eq("series_id", o.item_ref).is("episode_number", null).eq("source", "pass");
  } else if (o.item_type === "subscription" && o.subscription_id) {
    await db().from("subscriptions").update({ status: "expired", auto_renew: false, current_period_end: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", o.subscription_id);
  }
  return { ok: true };
}
