"use client";
// "Log out" row on the profile page: signs this device out (same endpoint as Settings) and returns to the splash.

import { useState } from "react";
import { ChevronIcon, LogoutIcon } from "@/components/brand/icons";

export function SignOutRow({ label, rtl }: { label: string; rtl: boolean }) {
  const [busy, setBusy] = useState(false);
  async function signOut() {
    setBusy(true);
    await fetch("/api/me/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "this" }) }).catch(() => null);
    window.location.href = "/";
  }
  return (
    <button type="button" onClick={signOut} disabled={busy} aria-busy={busy}>
      <span className="wc-tile" style={{ background: "#ffece8" }}>
        <LogoutIcon color="#d6402e" />
      </span>
      <span className="wc-grow" style={{ color: "var(--wc-coral-text)" }}>{label}</span>
      <ChevronIcon color="#8a847e" rtl={rtl} />
    </button>
  );
}
