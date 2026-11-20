"use client";

// Language switch and device sign-out buttons for the settings page.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { webCopy, type Locale } from "@/lib/web-copy";

export function LanguageSwitch({ locale }: { locale: Locale }) {
  const t = webCopy(locale);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function set(next: Locale) {
    if (next === locale) return;
    setBusy(true);
    await fetch("/api/me/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locale: next }) });
    setBusy(false);
    router.refresh();
  }
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <button className={`btn${locale === "ar" ? "" : " secondary"}`} type="button" disabled={busy} onClick={() => set("ar")}>
        {t.arabic}
      </button>
      <button className={`btn${locale === "en" ? "" : " secondary"}`} type="button" disabled={busy} onClick={() => set("en")}>
        {t.englishSubs}
      </button>
    </div>
  );
}

export function DeviceButtons({ locale, hasOthers }: { locale: Locale; hasOthers: boolean }) {
  const t = webCopy(locale);
  const router = useRouter();
  async function act(action: "this" | "others") {
    await fetch("/api/me/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    if (action === "this") window.location.href = "/";
    else router.refresh();
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {hasOthers && (
        <button className="btn secondary" type="button" onClick={() => act("others")}>
          {t.signOutOthers}
        </button>
      )}
      <button className="btn secondary" type="button" onClick={() => act("this")}>
        {t.signOutThis}
      </button>
    </div>
  );
}
