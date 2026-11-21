// Offers & promotions: free-Ping rewards (welcome, daily check-in, first-purchase bonus), promotions (discounts,
// bonus Ping, free-Ping codes, with audience, countries, dates and limits), invites (double-sided referrals) and
// partners (affiliate links with commission on paid orders).

import { Flash } from "@/components/admin/Flash";
import { can, requireAdmin } from "@/lib/admin/auth";
import { countryName } from "@/lib/economy/countries";
import { economySettings, toPromotion } from "@/lib/economy/store";
import { siteUrl } from "@/lib/site/store";
import { db } from "@/lib/supabase";
import { saveAffiliateAction, savePromotionAction, saveRewardSettingsAction, settleCommissionsAction } from "../../economy-actions";

export const dynamic = "force-dynamic";

const KIND_LABEL = { bonus_ping: "Bonus Ping on packs", discount: "Discount", free_ping: "Free Ping code" } as const;
const AUDIENCE_LABEL = { everyone: "Everyone", new: "New viewers (first 7 days)", first_purchase: "Never bought", lapsed: "Lapsed (14+ days away)" } as const;

export default async function OffersPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const admin = await requireAdmin("offers");
  const sp = await searchParams;
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const [settings, { data: markets }, { data: promos }, { data: affs }, { data: grants }, { data: refs }, { data: comms }, { data: signups }, base] =
    await Promise.all([
      economySettings(admin.tenantId),
      db().from("markets").select("country").eq("tenant_id", admin.tenantId).eq("active", true).order("sort"),
      db().from("promotions").select("*").eq("tenant_id", admin.tenantId).order("created_at", { ascending: false }),
      db().from("affiliates").select("*").eq("tenant_id", admin.tenantId).order("created_at", { ascending: false }),
      db()
        .from("wallet_ledger")
        .select("delta, ref_type, viewers!inner(tenant_id)")
        .eq("viewers.tenant_id", admin.tenantId)
        .eq("reason", "grant")
        .gte("created_at", since)
        .limit(20000),
      db().from("referral_rewards").select("status, referrer_id, created_at").eq("tenant_id", admin.tenantId).gte("created_at", since),
      db().from("affiliate_commissions").select("affiliate_id, status, commission, base_amount, currency").eq("tenant_id", admin.tenantId),
      db().from("viewers").select("affiliate_id").eq("tenant_id", admin.tenantId).not("affiliate_id", "is", null),
      siteUrl(),
    ]);
  const countries = (markets ?? []).map((m) => m.country as string);
  const granted: Record<string, number> = {};
  for (const g of grants ?? []) granted[g.ref_type ?? "other"] = (granted[g.ref_type ?? "other"] ?? 0) + Number(g.delta);
  const refJoined = refs?.length ?? 0;
  const refRewarded = (refs ?? []).filter((r) => r.status === "rewarded").length;
  const promotions = (promos ?? []).map(toPromotion);
  const signupsBy = new Map<string, number>();
  for (const v of signups ?? []) signupsBy.set(v.affiliate_id as string, (signupsBy.get(v.affiliate_id as string) ?? 0) + 1);
  const siteBase = base.replace(/\/$/, "");
  const canSettle = can(admin, "orders");

  return (
    <>
      <h1>Offers &amp; promotions</h1>
      <Flash ok={sp.ok} err={sp.err} />

      <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
        <Stat label="Free Ping given · 30 days" value={Object.values(granted).reduce((a, b) => a + b, 0)} hint={summarise(granted)} />
        <Stat label="Invites · 30 days" value={refJoined} hint={`${refRewarded} bought (inviter rewarded)`} />
        <Stat label="Live promotions" value={promotions.filter((p) => p.active && (!p.endsAt || Date.parse(p.endsAt) > Date.now())).length} />
        <Stat label="Partners" value={(affs ?? []).filter((a) => a.active).length} hint={`${signups?.length ?? 0} viewers attributed`} />
      </div>

      {/* ------------------------------------------------------------------ Rewards */}
      <h2>Rewards (free Ping)</h2>
      <p className="muted">
        Free Ping is kept apart from bought Ping in the ledger. Best practice: a welcome gift that covers a few episodes past the free ones, a
        7-day check-in that grows towards day 7 (missing a day restarts it), a bonus on the first top-up, and invites that pay the inviter only
        after the friend buys (so fake accounts earn nothing), with a monthly cap.
      </p>
      <form action={saveRewardSettingsAction} className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="row">
          <label>
            Welcome Ping
            <input name="welcome_ping" type="number" min={0} max={10000} defaultValue={settings.welcomePing} style={{ width: 100 }} />
          </label>
          <label>
            Daily check-in ladder (day 1 → 7)
            <input name="checkin_ladder" defaultValue={settings.checkinLadder.join(", ")} style={{ width: 220 }} dir="ltr" />
          </label>
          <label>
            First top-up bonus %
            <input name="first_purchase_bonus_pct" type="number" min={0} max={300} defaultValue={settings.firstPurchaseBonusPct} style={{ width: 90 }} />
          </label>
        </div>
        <div className="row">
          <label>
            Invite: friend gets (Ping, on joining)
            <input name="referral_friend_ping" type="number" min={0} max={10000} defaultValue={settings.referralFriendPing} style={{ width: 100 }} />
          </label>
          <label>
            Invite: inviter gets (Ping, on friend&apos;s first purchase)
            <input name="referral_referrer_ping" type="number" min={0} max={10000} defaultValue={settings.referralReferrerPing} style={{ width: 100 }} />
          </label>
          <label>
            Inviter cap per month
            <input name="referral_monthly_cap" type="number" min={0} max={1000} defaultValue={settings.referralMonthlyCap} style={{ width: 90 }} />
          </label>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          One episode is {settings.episodePing} Ping, so the welcome gift opens {Math.floor(settings.welcomePing / Math.max(1, settings.episodePing))} episodes and a full
          check-in week gives {settings.checkinLadder.reduce((a, b) => a + b, 0)} Ping. Invite links look like <code dir="ltr">{siteBase}/i/ABC234</code>; viewers find
          theirs on the Rewards page.
        </p>
        <div>
          <button type="submit">Save rewards</button>
        </div>
      </form>

      {/* ------------------------------------------------------------------ Promotions */}
      <h2>Promotions</h2>
      <p className="muted">
        Without a code a promotion applies automatically to everyone it targets (its banner shows in the store); with a code, viewers type it in
        the store. Only the single best promotion applies to a purchase; the first top-up bonus applies only when no bonus promotion does.
      </p>
      {promotions.length === 0 && <p className="muted">No promotions yet.</p>}
      {promotions.map((p) => (
        <details key={p.id} className="card">
          <summary style={{ cursor: "pointer" }}>
            <strong>{p.name}</strong> · {KIND_LABEL[p.kind]} {p.kind === "free_ping" ? `${p.value} Ping` : `${p.value}%`}
            {p.code ? <> · code <code>{p.code}</code></> : " · automatic"} · {p.redemptions} used
            {!p.active && <span className="muted"> · off</span>}
            {p.endsAt && Date.parse(p.endsAt) < Date.now() && <span className="muted"> · ended</span>}
          </summary>
          <PromotionForm p={p} countries={countries} />
        </details>
      ))}
      <h3>New promotion</h3>
      <div className="card">
        <PromotionForm countries={countries} />
      </div>

      {/* ------------------------------------------------------------------ Partners */}
      <h2>Partners (affiliates)</h2>
      <p className="muted">
        Influencers, pages and resellers get a link <code dir="ltr">{siteBase}/r/CODE</code> that opens WhatsApp with their code. New viewers who
        start from it are theirs for the attribution window, and they earn their commission % on those viewers&apos; payments (excluding VAT,
        renewals included). Approve commissions after the refund period, then mark them paid when you transfer.
      </p>
      {(affs ?? []).length > 0 && (
        <div className="card" style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Partner</th>
                <th>Link</th>
                <th>Clicks</th>
                <th>Viewers</th>
                <th>Sales (excl. VAT)</th>
                <th>Pending</th>
                <th>Approved</th>
                <th>Paid</th>
                {canSettle && <th />}
              </tr>
            </thead>
            <tbody>
              {(affs ?? []).map((a) => {
                const mine = (comms ?? []).filter((c) => c.affiliate_id === a.id);
                const sum = (status?: string) => moneyByCurrency(mine.filter((c) => !status || c.status === status), status ? "commission" : "base_amount");
                const pending = mine.some((c) => c.status === "pending");
                const approved = mine.some((c) => c.status === "approved");
                return (
                  <tr key={a.id} style={{ opacity: a.active ? 1 : 0.5 }}>
                    <td>
                      <strong>{a.name}</strong>
                      <span className="muted" style={{ display: "block", fontSize: 12 }}>
                        {Number(a.commission_pct)}% · {a.window_days} days
                      </span>
                    </td>
                    <td dir="ltr"><code>/r/{a.code}</code></td>
                    <td>{a.clicks}</td>
                    <td>{signupsBy.get(a.id) ?? 0}</td>
                    <td>{sum() || "—"}</td>
                    <td>{sum("pending") || "—"}</td>
                    <td>{sum("approved") || "—"}</td>
                    <td>{sum("paid") || "—"}</td>
                    {canSettle && (
                      <td style={{ whiteSpace: "nowrap" }}>
                        {pending && (
                          <form action={settleCommissionsAction} style={{ display: "inline" }}>
                            <input type="hidden" name="affiliate_id" value={a.id} />
                            <input type="hidden" name="to" value="approved" />
                            <button type="submit" className="secondary">Approve</button>
                          </form>
                        )}{" "}
                        {approved && (
                          <form action={settleCommissionsAction} style={{ display: "inline" }}>
                            <input type="hidden" name="affiliate_id" value={a.id} />
                            <input type="hidden" name="to" value="paid" />
                            <button type="submit" className="secondary">Mark paid</button>
                          </form>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {(affs ?? []).map((a) => (
        <details key={a.id} className="card">
          <summary style={{ cursor: "pointer" }}>Edit {a.name}</summary>
          <AffiliateForm a={a} />
        </details>
      ))}
      <h3>New partner</h3>
      <div className="card">
        <AffiliateForm />
      </div>
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="card" style={{ minWidth: 180, flex: 1 }}>
      <div className="muted" style={{ fontSize: 13 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700 }}>{value.toLocaleString("en")}</div>
      {hint && <div className="muted" style={{ fontSize: 12 }}>{hint}</div>}
    </div>
  );
}

function summarise(byKind: Record<string, number>) {
  const order = ["welcome", "checkin", "referral", "promo", "admin"];
  return Object.entries(byKind)
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([k, v]) => `${k} ${v.toLocaleString("en")}`)
    .join(" · ");
}

function moneyByCurrency(rows: { currency: string; commission: number | string; base_amount: number | string }[], field: "commission" | "base_amount") {
  const by: Record<string, number> = {};
  for (const r of rows) by[r.currency] = (by[r.currency] ?? 0) + Number(r[field]);
  return Object.entries(by)
    .map(([c, v]) => `${Math.round(v * 100) / 100} ${c}`)
    .join(" · ");
}

const toLocal = (iso: string | null) => (iso ? new Date(Date.parse(iso) + 4 * 3600_000).toISOString().slice(0, 16) : "");

function PromotionForm({ p, countries }: { p?: ReturnType<typeof toPromotion>; countries: string[] }) {
  return (
    <form action={savePromotionAction} style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: p ? 10 : 0 }}>
      {p && <input type="hidden" name="id" value={p.id} />}
      <div className="row">
        <label>
          Name (team only)
          <input name="name" defaultValue={p?.name ?? ""} maxLength={80} required style={{ width: 220 }} />
        </label>
        <label>
          Type
          <select name="kind" defaultValue={p?.kind ?? "bonus_ping"}>
            <option value="bonus_ping">Bonus Ping on packs (%)</option>
            <option value="discount">Discount (%)</option>
            <option value="free_ping">Free Ping code (Ping)</option>
          </select>
        </label>
        <label>
          Value
          <input name="value" type="number" min={1} defaultValue={p?.value ?? 20} style={{ width: 90 }} required />
        </label>
        <label>
          On
          <select name="applies_to" defaultValue={p?.appliesTo ?? "packs"}>
            <option value="packs">Ping packs</option>
            <option value="passes">Passes</option>
            <option value="all">Everything</option>
          </select>
        </label>
        <label>
          Code (empty = automatic)
          <input name="code" defaultValue={p?.code ?? ""} maxLength={20} dir="ltr" style={{ width: 130, textTransform: "uppercase" }} />
        </label>
      </div>
      <div className="row">
        <label>
          Who
          <select name="audience" defaultValue={p?.audience ?? "everyone"}>
            {Object.entries(AUDIENCE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Starts (Gulf time)
          <input name="starts_at" type="datetime-local" defaultValue={toLocal(p?.startsAt ?? null)} />
        </label>
        <label>
          Ends
          <input name="ends_at" type="datetime-local" defaultValue={toLocal(p?.endsAt ?? null)} />
        </label>
        <label>
          Max uses (0 = no limit)
          <input name="max_redemptions" type="number" min={0} defaultValue={p?.maxRedemptions ?? 0} style={{ width: 100 }} />
        </label>
        <label>
          Per viewer
          <input name="per_viewer" type="number" min={1} max={100} defaultValue={p?.perViewer ?? 1} style={{ width: 80 }} />
        </label>
      </div>
      <fieldset className="row" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="muted" style={{ fontSize: 13 }}>Countries (none = all)</legend>
        {countries.map((c) => (
          <label key={c} className="inline">
            <input type="checkbox" name="countries" value={c} defaultChecked={p?.countries.includes(c)} /> {countryName(c)}
          </label>
        ))}
      </fieldset>
      <div className="row">
        <label style={{ flex: 1 }}>
          Store banner (Arabic)
          <input name="banner_ar" defaultValue={p?.bannerAr ?? ""} maxLength={140} dir="rtl" placeholder="عرض نهاية الأسبوع: +30٪ بينج على كل الباقات 🎁" />
        </label>
        <label style={{ flex: 1 }}>
          Store banner (English)
          <input name="banner_en" defaultValue={p?.bannerEn ?? ""} maxLength={140} placeholder="Weekend deal: +30% Ping on every pack 🎁" />
        </label>
      </div>
      <div className="row">
        <label className="inline">
          <input type="checkbox" name="active" defaultChecked={p?.active ?? true} /> Active
        </label>
        <button type="submit">{p ? "Save promotion" : "Add promotion"}</button>
      </div>
    </form>
  );
}

type Aff = { id: string; name: string; code: string; commission_pct: number | string; window_days: number; contact: string | null; notes: string | null; active: boolean };

function AffiliateForm({ a }: { a?: Aff }) {
  return (
    <form action={saveAffiliateAction} style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: a ? 10 : 0 }}>
      {a && <input type="hidden" name="id" value={a.id} />}
      <div className="row">
        <label>
          Name
          <input name="name" defaultValue={a?.name ?? ""} maxLength={80} required style={{ width: 200 }} />
        </label>
        <label>
          Code
          <input name="code" defaultValue={a?.code ?? ""} maxLength={20} required dir="ltr" style={{ width: 130, textTransform: "uppercase" }} />
        </label>
        <label>
          Commission %
          <input name="commission_pct" type="number" step="0.5" min={0} max={90} defaultValue={a ? Number(a.commission_pct) : 20} style={{ width: 90 }} />
        </label>
        <label>
          Attribution window (days)
          <input name="window_days" type="number" min={1} max={3650} defaultValue={a?.window_days ?? 90} style={{ width: 100 }} />
        </label>
      </div>
      <div className="row">
        <label style={{ flex: 1 }}>
          Contact (team only)
          <input name="contact" defaultValue={a?.contact ?? ""} maxLength={120} />
        </label>
        <label style={{ flex: 2 }}>
          Notes
          <input name="notes" defaultValue={a?.notes ?? ""} maxLength={500} />
        </label>
      </div>
      <div className="row">
        <label className="inline">
          <input type="checkbox" name="active" defaultChecked={a?.active ?? true} /> Active
        </label>
        <button type="submit">{a ? "Save partner" : "Add partner"}</button>
      </div>
    </form>
  );
}
