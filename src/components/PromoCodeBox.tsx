"use client";

// "Have a code?" in the store: free-Ping codes are added at once; discount / bonus codes stay in the box and
// travel with the next purchase (BuyButton reads #promo-code), where the server decides if they apply.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { webCopy, type Locale } from "@/lib/web-copy";

export function PromoCodeBox({ locale }: { locale: Locale }) {
  const t = webCopy(locale);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  async function apply(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem("code") as HTMLInputElement;
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/rewards/code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: input.value }) });
    const j = (await res.json().catch(() => ({}))) as { result?: string; ping?: number; error?: string };
    setBusy(false);
    if (j.result === "ok") {
      input.value = "";
      setMsg({ text: t.codeOk(j.ping ?? 0), ok: true });
      router.refresh();
    } else if (j.result === "checkout") setMsg({ text: t.codeAtCheckout, ok: true });
    else if (j.result === "used") setMsg({ text: t.codeUsed, ok: false });
    else if (j.result === "limit") setMsg({ text: t.codeLimit, ok: false });
    else setMsg({ text: j.error === "slow_down" ? t.error : t.codeInvalid, ok: false });
  }

  return (
    <form onSubmit={apply} className="wc-card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
      <label htmlFor="promo-code" style={{ fontWeight: 600 }}>{t.promoCode}</label>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          id="promo-code"
          name="code"
          dir="ltr"
          autoCapitalize="characters"
          autoComplete="off"
          maxLength={20}
          placeholder={t.promoPlaceholder}
          style={{ flex: 1, minWidth: 0, minHeight: 46, borderRadius: 12, border: "1px solid var(--wc-line, #e5e5e5)", background: "var(--wc-card-2, #fff)", color: "var(--wc-ink)", padding: "0 12px", fontSize: 16, textTransform: "uppercase" }}
        />
        <button className="btn secondary" type="submit" disabled={busy} style={{ minWidth: 88 }}>
          {t.apply}
        </button>
      </div>
      {msg && (
        <span role="status" style={{ fontSize: 14, color: msg.ok ? "var(--wc-mint-text)" : "var(--wc-coral-text)" }}>
          {msg.text}
        </span>
      )}
    </form>
  );
}
