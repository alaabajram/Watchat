"use client";

// P8 — paywall sheet over a locked episode: unlock with Ping, buy the series pass or the weekly pass, or top up Ping.

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney, webCopy, type Locale } from "@/lib/web-copy";
import { PingIcon } from "./brand/PingIcon";
import { openTelegramInvoice } from "./TelegramSignIn";
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
  weeklyPassLabel?: string | null;
  returnTo: string;
};

export function Paywall(p: Props) {
  const t = webCopy(p.locale);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<null | "unlock" | "pass" | "weekly">(null);

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

  const buyPass = useCallback(async (kind: "pass" | "weekly" = "pass") => {
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        kind === "weekly" ? { type: "subscription", id: "weekly", returnTo: p.returnTo } : { type: "season_pass", id: p.seriesId, returnTo: p.returnTo },
      ),
    });
    const j = (await res.json().catch(() => ({}))) as {
      url?: string;
      invoice?: string;
      error?: string;
      pending?: boolean;
      reference?: string;
      amount?: number;
      currency?: string;
    };
    if (j.pending && j.reference) {
      setBusy(false);
      return setMessage(t.cashRequested(j.reference, formatMoney(j.amount ?? 0, j.currency ?? "AED", p.locale)));
    }
    if (j.error === "confirm_device") {
      setBusy(false);
      return setConfirming(kind);
    }
    if (j.invoice) {
      // Telegram viewers pay in Stars on Telegram's own sheet; the episode opens once the webhook adds the pass.
      const status = await openTelegramInvoice(j.invoice);
      setBusy(false);
      if (status === "paid") {
        setMessage(t.starsPaid);
        window.setTimeout(() => router.refresh(), 1500);
      } else if (status === "failed") setMessage(t.error);
      return;
    }
    if (j.url) {
      setMessage(t.redirecting);
      window.location.href = j.url;
      return;
    }
    setBusy(false);
    setMessage(j.error === "too_many_pending" ? t.tooManyPending : j.error === "payments_not_configured" ? t.paymentsSoon : t.error);
  }, [p.seriesId, p.returnTo, t, router]);

  if (confirming) {
    return (
      <ConfirmDevice
        locale={p.locale}
        onCancel={() => setConfirming(null)}
        onConfirmed={() => {
          const next = confirming;
          setConfirming(null);
          if (next === "unlock") void unlock();
          else void buyPass(next);
        }}
      />
    );
  }

  return (
    <div className="sheet">
      <strong>{t.paywallTitle}</strong>
      <span className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <PingIcon size={18} />
        {t.balance}: {t.coins(p.balance)}
      </span>
      <button className="btn" type="button" onClick={unlock} disabled={busy}>
        {busy ? t.unlocking : t.unlockFor(p.price)}
      </button>
      {p.seasonPassLabel && (
        <button className="btn secondary" type="button" onClick={() => buyPass("pass")} disabled={busy}>
          {p.seasonPassLabel}
        </button>
      )}
      {p.weeklyPassLabel && (
        <button className="btn secondary" type="button" onClick={() => buyPass("weekly")} disabled={busy}>
          {p.weeklyPassLabel}
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
