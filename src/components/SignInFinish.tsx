"use client";

// "Continue" on the email sign-in link page: uses the one-time link and goes on (home, or where they started).

import { useState } from "react";
import type { AccountSummary } from "@/lib/signin/accounts";
import { MergePrompt } from "./SignInMethods";
import { rememberSignIn } from "./SignInDoors";

const T = {
  ar: { inUse: "هذا البريد مرتبط بحساب آخر. افتح الرابط على الجهاز الذي طلبته منه لدمج الحسابين.", title: "تسجيل الدخول إلى واتشات", go: "متابعة", busy: "لحظة…", expired: "انتهى هذا الرابط أو استُخدم من قبل. اطلب رابطًا جديدًا.", again: "اطلب رابطًا جديدًا", error: "حدث خطأ. حاول مرة أخرى." },
  en: { inUse: "This email belongs to another account. Open the link on the device you asked from to merge the two.", title: "Sign in to Watchat", go: "Continue", busy: "One moment…", expired: "This link has expired or was already used. Ask for a new one.", again: "Get a new link", error: "Something went wrong. Try again." },
};

type Finish = { ok?: boolean; to?: string; error?: string; merge?: { token: string; summary: AccountSummary } };

export function EmailFinish({ token, locale }: { token: string; locale: "ar" | "en" }) {
  const t = T[locale];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(token ? null : t.expired);
  const [merge, setMerge] = useState<{ token: string; summary: AccountSummary } | null>(null);
  if (merge) return <MergePrompt locale={locale} merge={merge} onCancel={() => window.location.replace("/me")} />;
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
              .then((x) => x.json() as Promise<Finish>)
              .catch(() => ({ error: "error" }) as Finish);
            if (r.ok && r.to) {
              rememberSignIn();
              return window.location.replace(r.to);
            }
            setBusy(false);
            if (r.merge) return setMerge(r.merge);
            setError(r.error === "expired" ? t.expired : r.error === "in_use" ? t.inUse : t.error);
          }}
        >
          {busy ? t.busy : t.go}
        </button>
      )}
    </div>
  );
}
