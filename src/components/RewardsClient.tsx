"use client";

// Rewards page actions: claim today's check-in Ping, and share / copy the invite link.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { webCopy, type Locale } from "@/lib/web-copy";

export function ClaimButton({ locale, ping, claimed }: { locale: Locale; ping: number; claimed: boolean }) {
  const t = webCopy(locale);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(claimed ? t.claimedToday : null);

  async function claim() {
    setBusy(true);
    const res = await fetch("/api/rewards", { method: "POST" });
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; ping?: number };
    setBusy(false);
    setDone(j.ok ? t.claimed(j.ping ?? ping) : t.claimedToday);
    router.refresh();
  }

  if (done) return <p role="status" style={{ margin: 0, fontWeight: 600, color: "var(--wc-mint-text)" }}>{done}</p>;
  return (
    <button className="btn" type="button" onClick={claim} disabled={busy}>
      {t.claimPing(ping)}
    </button>
  );
}

export function InviteShare({ locale, url }: { locale: Locale; url: string }) {
  const t = webCopy(locale);
  const [copied, setCopied] = useState(false);
  async function share() {
    const text = t.inviteText(url);
    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch {
        /* cancelled: fall through to WhatsApp */
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  }
  async function copy() {
    await navigator.clipboard?.writeText(url).catch(() => undefined);
    setCopied(true);
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <button className="btn" type="button" onClick={share}>{t.inviteShare}</button>
      <button className="btn secondary" type="button" onClick={copy} dir="ltr" style={{ fontSize: 14 }}>
        {copied ? t.inviteCopied : url.replace(/^https?:\/\//, "")}
      </button>
    </div>
  );
}

export function AutoRenewToggle({ locale, on }: { locale: Locale; on: boolean }) {
  const t = webCopy(locale);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function toggle() {
    setBusy(true);
    await fetch("/api/subscription", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ autoRenew: !on }) });
    setBusy(false);
    router.refresh();
  }
  return (
    <button className="btn secondary" type="button" onClick={toggle} disabled={busy}>
      {on ? t.cancelRenew : t.resumeRenew}
    </button>
  );
}
