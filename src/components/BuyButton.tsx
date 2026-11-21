"use client";

// Starts a checkout for a Ping pack, a series pass or a weekly / yearly pass. A discount code typed in the store's
// code box (#promo-code) travels with it; the server decides whether it applies.

import { useState } from "react";
import { formatMoney, webCopy, type Locale } from "@/lib/web-copy";
import { ConfirmDevice } from "./ConfirmDevice";

export function BuyButton({
  locale,
  type,
  id,
  label,
  returnTo,
  secondary,
}: {
  locale: Locale;
  type: "coin_pack" | "season_pass" | "subscription";
  id: string;
  label: string;
  returnTo: string;
  secondary?: boolean;
}) {
  const t = webCopy(locale);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function buy() {
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, id, returnTo, code: readCode() }),
    });
    const j = (await res.json().catch(() => ({}))) as {
      url?: string;
      error?: string;
      pending?: boolean;
      reference?: string;
      amount?: number;
      currency?: string;
    };
    if (j.pending && j.reference) {
      setBusy(false);
      setMessage(t.cashRequested(j.reference, formatMoney(j.amount ?? 0, j.currency ?? "AED", locale)));
      return;
    }
    if (j.url) {
      setMessage(t.redirecting);
      window.location.href = j.url;
      return;
    }
    setBusy(false);
    if (j.error === "confirm_device") return setConfirming(true);
    setMessage(j.error === "too_many_pending" ? t.tooManyPending : j.error === "payments_not_configured" ? t.paymentsSoon : t.error);
  }

  if (confirming) {
    return (
      <ConfirmDevice
        locale={locale}
        onCancel={() => setConfirming(false)}
        onConfirmed={() => {
          setConfirming(false);
          void buy();
        }}
      />
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "stretch" }}>
      <button className={secondary ? "btn secondary" : "btn"} type="button" onClick={buy} disabled={busy}>
        {busy ? t.redirecting : label}
      </button>
      {message && (
        <span className="muted" role="status" style={{ fontSize: 13, whiteSpace: "pre-line" }}>
          {message}
        </span>
      )}
    </div>
  );
}

function readCode(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const el = document.getElementById("promo-code") as HTMLInputElement | null;
  const v = el?.value.trim();
  return v && /^[A-Za-z0-9]{3,20}$/.test(v) ? v : undefined;
}
