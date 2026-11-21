// Ping rewards — the daily check-in ladder (7 days, the streak resets if a day is missed) and the invite link
// (double-sided: the friend gets Ping when they start, the inviter when the friend first tops up).

import Link from "next/link";
import { PingIcon } from "@/components/brand/PingIcon";
import { BottomNav } from "@/components/home/BottomNav";
import { ClaimButton, InviteShare } from "@/components/RewardsClient";
import { TopBar } from "@/components/TopBar";
import { checkinStatus, inviteCode } from "@/lib/economy/rewards";
import { economySettings } from "@/lib/economy/store";
import { getSessionViewer } from "@/lib/session";
import { siteUrl } from "@/lib/site/store";
import { currentTenantId, db } from "@/lib/supabase";
import { getBalance } from "@/lib/wallet";
import { dirFor, webCopy } from "@/lib/web-copy";

export const dynamic = "force-dynamic";

export default async function RewardsPage() {
  const viewer = await getSessionViewer();
  const locale = viewer?.uiLocale ?? "ar";
  const t = webCopy(locale);
  if (!viewer) {
    return (
      <main className="page center" dir={dirFor(locale)}>
        <p>{t.signInFromWhatsApp}</p>
      </main>
    );
  }
  const tenantId = await currentTenantId();
  const [settings, state, code, balance, base, { data: refs }] = await Promise.all([
    economySettings(tenantId),
    checkinStatus(viewer.id, tenantId),
    inviteCode(viewer.id),
    getBalance(viewer.id),
    siteUrl(),
    db().from("referral_rewards").select("status, referrer_ping").eq("referrer_id", viewer.id),
  ]);
  const invited = refs?.length ?? 0;
  const earned = (refs ?? []).reduce((n, r) => n + (r.status === "rewarded" ? Number(r.referrer_ping) : 0), 0);
  // Days already claimed in this streak: up to yesterday (or today, once claimed).
  const doneUpTo = state.claimedToday ? state.streak : state.streak - 1;

  return (
    <div className="wc wc-app" dir={dirFor(locale)} lang={locale}>
      <TopBar locale={locale} balance={balance} />
      <div className="page" style={{ display: "flex", flexDirection: "column", gap: 18, paddingTop: 8 }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>{t.rewardsTitle}</h1>

        <section className="wc-card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 className="wc-section-title" style={{ margin: 0 }}>{t.dailyCheckin}</h2>
          <p className="muted" style={{ margin: 0 }}>{t.checkinBody}</p>
          <div className="wc-ladder">
            {state.ladder.map((ping, i) => {
              const day = i + 1;
              const cls = day <= doneUpTo ? "is-done" : day === state.streak && !state.claimedToday ? "is-today" : "";
              return (
                <div key={day} className={`wc-ladder-day ${cls}`}>
                  <span>{t.checkinDay(day)}</span>
                  <PingIcon size={22} />
                  <strong>{day <= doneUpTo ? "✓" : `+${ping}`}</strong>
                </div>
              );
            })}
          </div>
          <ClaimButton locale={locale} ping={state.nextPing} claimed={state.claimedToday} />
        </section>

        {settings.referralReferrerPing + settings.referralFriendPing > 0 && (
          <section className="wc-card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            <h2 className="wc-section-title" style={{ margin: 0 }}>🎁 {t.inviteTitle}</h2>
            <p className="muted" style={{ margin: 0 }}>{t.inviteBody(settings.referralFriendPing, settings.referralReferrerPing)}</p>
            <InviteShare locale={locale} url={`${base.replace(/\/$/, "")}/i/${code}`} />
            {invited > 0 && <p className="muted" style={{ margin: 0, fontSize: 13 }}>{t.invitedCount(invited, earned)}</p>}
          </section>
        )}

        <Link className="btn secondary" href="/store?back=/rewards">{t.getCoins}</Link>
      </div>
      <BottomNav locale={locale} current="rewards" />
    </div>
  );
}
