// Free Ping and growth rewards: welcome Ping, daily check-in streak, promo codes, double-sided invites
// (the friend gets Ping on joining, the inviter after the friend's first purchase, capped per month) and partner
// (affiliate) attribution with commission on paid orders. Every Ping grant goes through grant_reward (exactly once).

import { db } from "../supabase";
import { trackEvent } from "../events";
import { checkinState, codesIn, commissionFor, gulfDay, newInviteCode, promoApplies } from "./pricing";
import { economySettings, toPromotion, viewerFacts } from "./store";

export async function grantPing(viewerId: string, ping: number, kind: string, key: string): Promise<boolean> {
  if (ping <= 0) return false;
  const { data, error } = await db().rpc("grant_reward", { p_viewer: viewerId, p_ping: ping, p_kind: kind, p_key: key });
  if (error) throw new Error(`grant_reward failed: ${error.message}`);
  return data === true;
}

/** The viewer's own invite code (created the first time it's needed). */
export async function inviteCode(viewerId: string): Promise<string> {
  const { data } = await db().from("viewers").select("referral_code").eq("id", viewerId).maybeSingle();
  if (data?.referral_code) return data.referral_code as string;
  for (let i = 0; i < 6; i++) {
    const code = newInviteCode(crypto.getRandomValues(new Uint8Array(6)));
    const { error } = await db().from("viewers").update({ referral_code: code }).eq("id", viewerId).is("referral_code", null);
    if (!error) {
      const { data: again } = await db().from("viewers").select("referral_code").eq("id", viewerId).single();
      return again!.referral_code as string;
    }
    if (error.code !== "23505") throw new Error(error.message);
  }
  throw new Error("Could not create an invite code.");
}

/**
 * First contact: welcome Ping, and if the first message carried an invite (INV-XXXXXX) or partner (P-CODE) code,
 * link the viewer to whoever brought them. Only new viewers can be referred, and never by themselves.
 */
export async function onNewViewer(p: { viewerId: string; tenantId: string; firstText?: string | null; phoneHmac?: string | null }) {
  const settings = await economySettings(p.tenantId);
  await grantPing(p.viewerId, settings.welcomePing, "welcome", `welcome:${p.viewerId}`).catch((e) => console.error("[rewards] welcome", e));
  if (!p.firstText) return;
  const { invite, partner } = codesIn(p.firstText);
  if (invite) {
    const { data: referrer } = await db().from("viewers").select("id").eq("tenant_id", p.tenantId).eq("referral_code", invite).maybeSingle();
    if (referrer && referrer.id !== p.viewerId) {
      const { error } = await db().from("referral_rewards").insert({
        tenant_id: p.tenantId,
        referrer_id: referrer.id,
        friend_id: p.viewerId,
        friend_ping: settings.referralFriendPing,
      });
      if (!error) {
        await db().from("viewers").update({ referred_by: referrer.id }).eq("id", p.viewerId);
        await grantPing(p.viewerId, settings.referralFriendPing, "referral", `referral-friend:${p.viewerId}`);
        await trackEvent({ viewerHmac: p.phoneHmac ?? null, name: "referral_joined", props: {} });
      }
    }
  }
  if (partner) {
    const { data: aff } = await db().from("affiliates").select("id").eq("tenant_id", p.tenantId).eq("code", partner).eq("active", true).maybeSingle();
    if (aff) {
      await db().from("viewers").update({ affiliate_id: aff.id, affiliate_at: new Date().toISOString() }).eq("id", p.viewerId).is("affiliate_id", null);
      await trackEvent({ viewerHmac: p.phoneHmac ?? null, name: "affiliate_joined", props: { affiliate_id: aff.id } });
    }
  }
}

// ---------------------------------------------------------------------------
// Daily check-in
// ---------------------------------------------------------------------------

export async function checkinStatus(viewerId: string, tenantId: string) {
  const settings = await economySettings(tenantId);
  const { data } = await db()
    .from("reward_claims")
    .select("day, streak")
    .eq("viewer_id", viewerId)
    .eq("kind", "checkin")
    .order("day", { ascending: false })
    .limit(1)
    .maybeSingle();
  return checkinState(data ? { day: data.day as string, streak: data.streak as number } : null, settings.checkinLadder, Date.now());
}

export async function claimCheckin(viewerId: string, tenantId: string): Promise<{ ok: boolean; ping: number; streak: number }> {
  const state = await checkinStatus(viewerId, tenantId);
  if (state.claimedToday || state.nextPing <= 0) return { ok: false, ping: 0, streak: state.streak };
  const { error } = await db().from("reward_claims").insert({ viewer_id: viewerId, kind: "checkin", day: state.today, streak: state.streak, ping: state.nextPing });
  if (error) return { ok: false, ping: 0, streak: state.streak }; // another tab claimed today
  await grantPing(viewerId, state.nextPing, "checkin", `checkin:${viewerId}:${state.today}`);
  return { ok: true, ping: state.nextPing, streak: state.streak };
}

// ---------------------------------------------------------------------------
// Promo codes (free Ping)
// ---------------------------------------------------------------------------

export type RedeemResult = "ok" | "used" | "limit" | "invalid";

export async function redeemCode(viewerId: string, tenantId: string, rawCode: string, country: string): Promise<{ result: RedeemResult; ping: number }> {
  const code = rawCode.trim().toUpperCase();
  if (!/^[A-Z0-9]{3,20}$/.test(code)) return { result: "invalid", ping: 0 };
  const { data } = await db().from("promotions").select("*").eq("tenant_id", tenantId).eq("code", code).maybeSingle();
  if (!data) return { result: "invalid", ping: 0 };
  const promo = toPromotion(data);
  if (promo.kind !== "free_ping") return { result: "invalid", ping: 0 }; // discount codes are entered at checkout
  if (!promoApplies(promo, "code", await viewerFacts(viewerId), country, Date.now())) {
    const facts = await viewerFacts(viewerId);
    return { result: (facts.used[promo.id] ?? 0) >= promo.perViewer ? "used" : promo.maxRedemptions !== null && promo.redemptions >= promo.maxRedemptions ? "limit" : "invalid", ping: 0 };
  }
  const { data: res, error } = await db().rpc("redeem_ping_code", { p_viewer: viewerId, p_promotion: promo.id });
  if (error) throw new Error(`redeem_ping_code failed: ${error.message}`);
  return { result: res as RedeemResult, ping: res === "ok" ? promo.value : 0 };
}

// ---------------------------------------------------------------------------
// After a paid order: inviter reward and partner commission
// ---------------------------------------------------------------------------

export async function afterPaid(orderId: string): Promise<void> {
  const { data: order } = await db()
    .from("orders")
    .select("id, viewer_id, amount, vat_amount, currency, created_at, is_renewal, status")
    .eq("id", orderId)
    .maybeSingle();
  if (!order || order.status !== "paid") return;
  const { data: viewer } = await db().from("viewers").select("id, tenant_id, referred_by, affiliate_id, affiliate_at").eq("id", order.viewer_id).single();
  if (!viewer) return;

  // Invite: the inviter is rewarded once, on the friend's first paid order, up to the monthly cap.
  if (viewer.referred_by && !order.is_renewal) {
    const { data: ref } = await db().from("referral_rewards").select("id, status").eq("friend_id", viewer.id).maybeSingle();
    if (ref && ref.status === "joined") {
      const settings = await economySettings(viewer.tenant_id);
      const monthStart = `${gulfDay(Date.now()).slice(0, 7)}-01T00:00:00+04:00`;
      const { count } = await db()
        .from("referral_rewards")
        .select("id", { count: "exact", head: true })
        .eq("referrer_id", viewer.referred_by)
        .eq("status", "rewarded")
        .gte("rewarded_at", monthStart);
      if ((count ?? 0) >= settings.referralMonthlyCap) {
        await db().from("referral_rewards").update({ status: "capped" }).eq("id", ref.id).eq("status", "joined");
      } else {
        const { data: claimed } = await db()
          .from("referral_rewards")
          .update({ status: "rewarded", referrer_ping: settings.referralReferrerPing, rewarded_at: new Date().toISOString() })
          .eq("id", ref.id)
          .eq("status", "joined")
          .select("id");
        if (claimed?.length) await grantPing(viewer.referred_by, settings.referralReferrerPing, "referral", `referral:${viewer.id}`);
      }
    }
  }

  // Partner: commission on every paid order (renewals too) inside the partner's attribution window.
  if (viewer.affiliate_id && viewer.affiliate_at) {
    const { data: aff } = await db().from("affiliates").select("id, commission_pct, window_days, active").eq("id", viewer.affiliate_id).maybeSingle();
    const inWindow = aff && Date.parse(order.created_at) - Date.parse(viewer.affiliate_at) <= aff.window_days * 86400_000;
    if (aff && aff.active && inWindow && Number(aff.commission_pct) > 0) {
      const { base, commission } = commissionFor(Number(order.amount), Number(order.vat_amount), Number(aff.commission_pct), order.currency);
      await db()
        .from("affiliate_commissions")
        .upsert(
          { tenant_id: viewer.tenant_id, affiliate_id: aff.id, order_id: order.id, viewer_id: viewer.id, base_amount: base, currency: order.currency, commission },
          { onConflict: "order_id", ignoreDuplicates: true },
        );
    }
  }
}
