"use client";

// "Continue" on the email sign-in link page: uses the one-time link and goes on (home, or where they started).

import { useState } from "react";

const T = {
  ar: { title: "تسجيل الدخول إلى واتشات", go: "متابعة", busy: "لحظة…", expired: "انتهى هذا الرابط أو استُخدم من قبل. اطلب رابطًا جديدًا.", again: "اطلب رابطًا جديدًا", error: "حدث خطأ. حاول مرة أخرى." },
  en: { title: "Sign in to Watchat", go: "Continue", busy: "One moment…", expired: "This link has expired or was already used. Ask for a new one.", again: "Get a new link", error: "Something went wrong. Try again." },
};

export function EmailFinish({ token, locale }: { token: string; locale: "ar" | "en" }) {
  const t = T[locale];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(token ? null : t.expired);
  return (
    <div style={{ width: "100%", maxWidth: 420, display: "flex", flexDirection: "column", gap: 16, textAlign: "center" }}>
      <h1 style={{ fontSize: 22, margin: 0 }}>{t.title}</h1>
      {error ? (
        <>
          <p className="wc-signin-error" role="alert">
            {error}
          </p>
          <a className="wc-btn wc-btn-ghost" href={locale === "en" ? "/?lang=en" : "/"}>
            {t.again}
          </a>
        </>
      ) : (
        <button
          type="button"
          className="wc-btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await fetch("/api/signin/email/finish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) })
              .then((x) => x.json() as Promise<{ ok?: boolean; to?: string; error?: string }>)
              .catch(() => ({ error: "error" }) as { ok?: boolean; to?: string; error?: string });
            if (r.ok && r.to) return window.location.replace(r.to);
            setBusy(false);
            setError(r.error === "expired" ? t.expired : t.error);
          }}
        >
          {busy ? t.busy : t.go}
        </button>
      )}
    </div>
  );
}
