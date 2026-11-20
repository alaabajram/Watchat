"use client";

// P8 — paywall sheet over a locked episode: unlock with coins, buy the season pass, or get coins.

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney, webCopy, type Locale } from "@/lib/web-copy";
import { ConfirmDevice } from "./ConfirmDevice";

type Props = {
  locale: Locale;
  episodeId: string;
  price: number;
  balance: number;
  trusted: boolean;
  seriesCode: string;
  seriesId: string;
  seasonPassLabel: string | null;
  returnTo: string;
};

export function Paywall(p: Props) {
  const t = webCopy(p.locale);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<null | "unlock" | "pass">(null);

  const unlock = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/wallet/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ episodeId: p.episodeId }),
    });
    const j = (await res.json().catch(() => ({}))) as { result?: string; error?: string };
    setBusy(false);
    if (j.error === "confirm_device") return setConfirming("unlock");
    if (j.result === "ok" || j.result === "already") return router.refresh();
    if (j.result === "insufficient") return setMessage(t.notEnoughCoins);
    setMessage(t.error);
  }, [p.episodeId, router, t]);

  const buyPass = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "season_pass", id: p.seriesId, returnTo: p.returnTo }),
    });
    const j = (await res.json().catch(() => ({}))) as {
      url?: string;
      error?: string;
      pending?: boolean;
      reference?: string;
      amount?: number;
      currency?: "AED" | "SAR";
    };
    if (j.pending && j.reference) {
      setBusy(false);
      return setMessage(t.cashRequested(j.reference, formatMoney(j.amount ?? 0, j.currency ?? "AED", p.locale)));
    }
    if (j.error === "confirm_device") {
      setBusy(false);
      return setConfirming("pass");
    }
    if (j.url) {
      setMessage(t.redirecting);
      window.location.href = j.url;
      return;
    }
    setBusy(false);
    setMessage(j.error === "too_many_pending" ? t.tooManyPending : j.error === "payments_not_configured" ? t.paymentsSoon : t.error);
  }, [p.seriesId, p.returnTo, t]);

  if (confirming) {
    return (
      <ConfirmDevice
        locale={p.locale}
        onCancel={() => setConfirming(null)}
        onConfirmed={() => {
          const next = confirming;
          setConfirming(null);
          if (next === "unlock") void unlock();
          else void buyPass();
        }}
      />
    );
  }

  return (
    <div className="sheet">
      <strong>{t.paywallTitle}</strong>
      <span className="muted">
        {t.balance}: {t.coins(p.balance)}
      </span>
      <button className="btn" type="button" onClick={unlock} disabled={busy}>
        {busy ? t.unlocking : t.unlockFor(p.price)}
      </button>
      {p.seasonPassLabel && (
        <button className="btn secondary" type="button" onClick={buyPass} disabled={busy}>
          {p.seasonPassLabel}
        </button>
      )}
      <a className="btn secondary" href={`/store?back=${encodeURIComponent(p.returnTo)}`}>
        {t.getCoins}
      </a>
      <a className="muted" href={`/series/${p.seriesCode}`} style={{ textAlign: "center" }}>
        {t.notNow}
      </a>
      {message && (
        <p className="muted" role="status" style={{ margin: 0, whiteSpace: "pre-line" }}>
          {message}
        </p>
      )}
    </div>
  );
}
