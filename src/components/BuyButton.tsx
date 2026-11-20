"use client";

// Starts a Tap checkout for a coin pack or season pass (asks to confirm the device first if needed).

import { useState } from "react";
import { webCopy, type Locale } from "@/lib/web-copy";
import { ConfirmDevice } from "./ConfirmDevice";

export function BuyButton({
  locale,
  type,
  id,
  label,
  returnTo,
}: {
  locale: Locale;
  type: "coin_pack" | "season_pass";
  id: string;
  label: string;
  returnTo: string;
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
      body: JSON.stringify({ type, id, returnTo }),
    });
    const j = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (j.url) {
      setMessage(t.redirecting);
      window.location.href = j.url;
      return;
    }
    setBusy(false);
    if (j.error === "confirm_device") return setConfirming(true);
    setMessage(j.error === "payments_not_configured" ? t.paymentsSoon : t.error);
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
      <button className="btn" type="button" onClick={buy} disabled={busy}>
        {busy ? t.redirecting : label}
      </button>
      {message && (
        <span className="muted" role="status" style={{ fontSize: 13 }}>
          {message}
        </span>
      )}
    </div>
  );
}
