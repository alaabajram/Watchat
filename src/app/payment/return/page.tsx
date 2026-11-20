// P11 Payment result — Tap sends the viewer back here. We confirm the charge with Tap's API ourselves.

import Link from "next/link";
import { getSessionViewer } from "@/lib/session";
import { db } from "@/lib/supabase";
import { verifyAndFulfil, type PaymentOutcome } from "@/lib/wallet";
import { dirFor, webCopy } from "@/lib/web-copy";

export const dynamic = "force-dynamic";

export default async function PaymentReturn({ searchParams }: { searchParams: Promise<{ tap_id?: string; order?: string; back?: string }> }) {
  const sp = await searchParams;
  const viewer = await getSessionViewer();
  const locale = viewer?.uiLocale ?? "ar";
  const t = webCopy(locale);
  const back = sp.back && sp.back.startsWith("/") && !sp.back.startsWith("//") ? sp.back : "/wallet";

  let chargeId = sp.tap_id;
  if (!chargeId && sp.order && /^[0-9a-f-]{36}$/.test(sp.order)) {
    const { data } = await db().from("orders").select("gateway_charge_id").eq("id", sp.order).maybeSingle();
    chargeId = data?.gateway_charge_id ?? undefined;
  }

  let outcome: PaymentOutcome = "unknown";
  if (chargeId) {
    try {
      outcome = (await verifyAndFulfil(chargeId)).outcome;
    } catch (e) {
      console.error("[payment-return] verify failed", e);
    }
  }

  const ok = outcome === "paid" || outcome === "already";
  return (
    <main className="page center" dir={dirFor(locale)}>
      <h1 style={{ margin: 0 }}>{ok ? t.paymentDone : outcome === "pending" ? t.paymentPending : t.paymentFailed}</h1>
      {ok || outcome === "pending" ? (
        <Link className="btn" href={back}>
          {t.backToWatching}
        </Link>
      ) : (
        <>
          <Link className="btn" href={`/store?back=${encodeURIComponent(back)}`}>
            {t.tryAgain}
          </Link>
          <Link className="btn secondary" href={back}>
            {t.backToWatching}
          </Link>
        </>
      )}
    </main>
  );
}
