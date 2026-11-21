// Weekly / yearly passes: automatic renewal with the card saved on the first payment (Tap merchant-initiated
// charge), retries, expiry and cancelling. Runs from the 15-minute cron. Renewals only happen when the platform
// switch "Passes renew automatically" is on (Tap's Save Card enabled) and Tap is configured.

import { db } from "../supabase";
import { siteUrl } from "../site/store";
import { chargeSavedCard, tapConfigured } from "../payments/tap";
import { verifyAndFulfil } from "../wallet";
import { loadEconomy } from "./store";
import { afterFailedAttempt, roundMoney, vatOf } from "./pricing";
import { setStarsRenewal } from "../telegram/payments";

export const RENEW_AHEAD_MS = 60 * 60 * 1000; // try up to 1 hour before the pass ends

export async function runBilling(): Promise<{ renewed: number; failed: number; expired: number }> {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  // Passes that ran out without renewing.
  const { data: ended } = await db()
    .from("subscriptions")
    .update({ status: "expired", updated_at: nowIso })
    .in("status", ["active", "past_due"])
    .lt("current_period_end", nowIso)
    .eq("auto_renew", false)
    .select("id");
  let renewed = 0;
  let failed = 0;
  const eco = await loadEconomy();
  if (!eco.settings.recurringEnabled || !tapConfigured()) return { renewed, failed, expired: ended?.length ?? 0 };

  const { data: due } = await db()
    .from("subscriptions")
    .select("id, viewer_id, plan, country, currency, amount, tap_customer_id, tap_card_id, tap_agreement_id, renew_attempts, next_attempt_at")
    .in("status", ["active", "past_due"])
    .eq("auto_renew", true)
    .is("tg_charge_id", null) // Telegram Stars passes are renewed by Telegram, not here
    .lte("current_period_end", new Date(now + RENEW_AHEAD_MS).toISOString())
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
    .limit(50);
  const base = await siteUrl();
  for (const sub of due ?? []) {
    if (!sub.tap_customer_id || !sub.tap_card_id || !sub.tap_agreement_id) {
      await db().from("subscriptions").update({ auto_renew: false, updated_at: nowIso }).eq("id", sub.id);
      continue;
    }
    // Hold the row so a parallel run doesn't charge twice: push the next attempt forward first.
    const { data: held } = await db()
      .from("subscriptions")
      .update({ next_attempt_at: new Date(now + 30 * 60 * 1000).toISOString() })
      .eq("id", sub.id)
      .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
      .select("id");
    if (!held?.length) continue;

    // Today's price in the pass's country (the team may have changed it), else what they paid last time.
    const market = eco.markets.find((m) => m.country === sub.country);
    const listed = sub.country ? eco.prices[sub.country]?.[sub.plan as "weekly" | "yearly"] : undefined;
    const currency = market?.currency ?? sub.currency ?? "USD";
    const amount = roundMoney(listed ?? Number(sub.amount), currency);
    const { data: order } = await db()
      .from("orders")
      .insert({
        viewer_id: sub.viewer_id,
        item_type: "subscription",
        item_ref: sub.plan,
        amount,
        list_amount: amount,
        currency,
        country: sub.country,
        vat_amount: vatOf(amount, market?.vatRate ?? 0, currency),
        gateway: "tap",
        is_renewal: true, // keeps auto-renew as it is; the saved card stays on the pass
        subscription_id: sub.id,
      })
      .select("id")
      .single();
    if (!order) continue;
    try {
      const charge = await chargeSavedCard({
        orderId: order.id,
        amount,
        currency,
        description: sub.plan === "weekly" ? "Watchat weekly pass (renewal)" : "Watchat yearly pass (renewal)",
        customerId: sub.tap_customer_id,
        cardId: sub.tap_card_id,
        agreementId: sub.tap_agreement_id,
        webhookUrl: `${base}/api/payments/tap`,
      });
      await db().from("orders").update({ gateway_charge_id: charge.id }).eq("id", order.id);
      const { outcome } = await verifyAndFulfil(charge.id);
      if (outcome === "paid" || outcome === "already") {
        renewed++;
        continue;
      }
      if (outcome === "pending") continue; // the webhook finishes it
    } catch (e) {
      console.error("[billing] renewal failed", sub.id, e instanceof Error ? e.message : e);
      await db().from("orders").update({ status: "failed" }).eq("id", order.id).eq("status", "pending");
    }
    failed++;
    await db().from("subscriptions").update({ ...afterFailedAttempt(sub.renew_attempts, now), updated_at: nowIso }).eq("id", sub.id);
  }
  return { renewed, failed, expired: ended?.length ?? 0 };
}

/** Viewer: stop or restart automatic renewal. The pass stays until the end of the paid period. */
export async function setAutoRenew(viewerId: string, on: boolean): Promise<boolean> {
  const { data: sub } = await db()
    .from("subscriptions")
    .select("id, tap_card_id, tg_charge_id, tg_user_id")
    .eq("viewer_id", viewerId)
    .in("status", ["active", "past_due"])
    .maybeSingle();
  if (!sub || (on && !sub.tap_card_id && !sub.tg_charge_id)) return false;
  // Telegram Stars subscription: Telegram renews it, so ask Telegram to stop / restart.
  if (sub.tg_charge_id && !(await setStarsRenewal(sub, on))) return false;
  await db()
    .from("subscriptions")
    .update({ auto_renew: on, cancelled_at: on ? null : new Date().toISOString(), renew_attempts: 0, next_attempt_at: null, updated_at: new Date().toISOString() })
    .eq("id", sub.id);
  return true;
}

export type ViewerPass = { plan: "weekly" | "monthly" | "yearly"; endsAt: string; autoRenew: boolean; canRenew: boolean; last4: string | null; pastDue: boolean };

export async function viewerPass(viewerId: string): Promise<ViewerPass | null> {
  const { data } = await db()
    .from("subscriptions")
    .select("plan, status, current_period_end, auto_renew, tap_card_id, card_last4, tg_charge_id")
    .eq("viewer_id", viewerId)
    .in("status", ["active", "past_due"])
    .gt("current_period_end", new Date().toISOString())
    .maybeSingle();
  if (!data) return null;
  return {
    plan: data.plan as ViewerPass["plan"],
    endsAt: data.current_period_end,
    autoRenew: data.auto_renew,
    canRenew: Boolean(data.tap_card_id || data.tg_charge_id),
    last4: data.card_last4,
    pastDue: data.status === "past_due",
  };
}
