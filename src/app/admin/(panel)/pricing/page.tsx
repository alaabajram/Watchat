// Coin packs. Per-episode coins, free episodes, paywall and season pass prices are set on each series.

import { Flash } from "@/components/admin/Flash";
import { requireAdmin } from "@/lib/admin/auth";
import { db } from "@/lib/supabase";
import { savePackAction } from "../../people-actions";

export const dynamic = "force-dynamic";

export default async function PricingPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const admin = await requireAdmin("pricing");
  const sp = await searchParams;
  const { data: packs } = await db().from("coin_packs").select("*").eq("tenant_id", admin.tenantId).order("sort");

  const row = (p?: { id: string; coins: number; bonus_coins: number; price_aed: number; price_sar: number; sort: number; active: boolean }) => (
    <form action={savePackAction} className="row card" key={p?.id ?? "new"}>
      {p && <input type="hidden" name="id" value={p.id} />}
      <label>
        Coins
        <input name="coins" type="number" min={1} defaultValue={p?.coins ?? ""} style={{ width: 90 }} required />
      </label>
      <label>
        Bonus
        <input name="bonus_coins" type="number" min={0} defaultValue={p?.bonus_coins ?? 0} style={{ width: 80 }} />
      </label>
      <label>
        AED (VAT incl.)
        <input name="price_aed" type="number" step="0.01" min={0} defaultValue={p?.price_aed ?? ""} style={{ width: 100 }} required />
      </label>
      <label>
        SAR (VAT incl.)
        <input name="price_sar" type="number" step="0.01" min={0} defaultValue={p?.price_sar ?? ""} style={{ width: 100 }} required />
      </label>
      <label>
        Order
        <input name="sort" type="number" defaultValue={p?.sort ?? 0} style={{ width: 70 }} />
      </label>
      <label className="inline" style={{ alignSelf: "end" }}>
        <input type="checkbox" name="active" defaultChecked={p?.active ?? true} /> On sale
      </label>
      <button type="submit" style={{ alignSelf: "end" }}>
        {p ? "Save" : "Add pack"}
      </button>
    </form>
  );

  return (
    <>
      <h1>Pricing · coin packs</h1>
      <Flash ok={sp.ok} err={sp.err} />
      <p className="muted">
        Keep the smallest pack at AED/SAR 15 or more: card fees have a fixed part that eats into small payments. Episode prices and season
        passes are set on each series page.
      </p>
      {(packs ?? []).map((p) => row(p))}
      <h2>New pack</h2>
      {row()}
    </>
  );
}
