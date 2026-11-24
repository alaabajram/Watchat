"use client";

// Profile → "Sign-in methods": every way into this account (phone, Telegram, email) and buttons to add the
// missing ones. Adding one that already opens another account shows what that account holds and asks to merge it
// into this one (`MergePrompt`, also used by the email link page).

import { useEffect, useState } from "react";
import type { AccountSummary, LoginRow } from "@/lib/signin/accounts";
import { loadTelegramScript, telegramInitData } from "./TelegramSignIn";

type Locale = "ar" | "en";

const T = {
  ar: {
    title: "طرق الدخول",
    hint: "حساب واحد لكل الطرق: ادخل بأي منها وتجد رصيدك ومشترياتك ومشاهداتك.",
    phone: "رقم الهاتف",
    telegram: "تيليجرام",
    email: "البريد الإلكتروني",
    whatsapp: "واتساب",
    main: "الأساسي",
    addPhone: "أضف رقم هاتف",
    sharePhone: "شارك رقمي من تيليجرام",
    addEmail: "أضف بريدًا إلكترونيًا",
    connectTelegram: "اربط تيليجرام",
    telegramOpened: "افتح بوت واتشات في تيليجرام واضغط «ابدأ». إذا كان لتيليجرام حساب في واتشات فسيُدمج في هذا الحساب.",
    shared: "شاركت رقمك. لحظة…",
    sendCode: "أرسل الرمز",
    codeSent: (p: string) => `أرسلنا رمزًا إلى ${p}`,
    confirm: "تأكيد",
    sendLink: "أرسل الرابط",
    linkSent: "أرسلنا رابطًا إلى بريدك. افتحه خلال ٣٠ دقيقة على هذا الجهاز.",
    cancel: "إلغاء",
    added: "تمت الإضافة ✅",
    already: "هذه الطريقة مرتبطة بحسابك من قبل.",
    busy: "لحظة…",
    errors: {
      invalid_number: "تحقّق من الرقم مع رمز الدولة.",
      invalid_email: "تحقّق من البريد الإلكتروني.",
      blocked: "لا يمكننا إرسال رمز لهذا الرقم الآن.",
      slow_down: "محاولات كثيرة. انتظر قليلًا.",
      wrong_code: "الرمز غير صحيح.",
      expired: "انتهت الصلاحية. حاول مرة أخرى.",
      use_telegram: "هذا الرقم لا يمكن إضافته.",
      not_configured: "هذه الطريقة غير متاحة الآن.",
      error: "حدث خطأ. حاول مرة أخرى.",
    } as Record<string, string>,
  },
  en: {
    title: "Sign-in methods",
    hint: "One account for every way in: sign in with any of them and find your Ping, purchases and progress.",
    phone: "Phone number",
    telegram: "Telegram",
    email: "Email",
    whatsapp: "WhatsApp",
    main: "Main",
    addPhone: "Add a phone number",
    sharePhone: "Share my number from Telegram",
    addEmail: "Add an email",
    connectTelegram: "Connect Telegram",
    telegramOpened: "Open the Watchat bot in Telegram and tap Start. If that Telegram already has a Watchat account, it's merged into this one.",
    shared: "Number shared. One moment…",
    sendCode: "Send code",
    codeSent: (p: string) => `We sent a code to ${p}`,
    confirm: "Confirm",
    sendLink: "Send link",
    linkSent: "We sent a link to your email. Open it within 30 minutes on this device.",
    cancel: "Cancel",
    added: "Added ✅",
    already: "This is already one of your sign-in methods.",
    busy: "One moment…",
    errors: {
      invalid_number: "Check the number, with the country code.",
      invalid_email: "Check the email address.",
      blocked: "We can't send a code to this number right now.",
      slow_down: "Too many tries. Wait a little.",
      wrong_code: "That code isn't right.",
      expired: "That expired. Try again.",
      use_telegram: "This number can't be added.",
      not_configured: "This way isn't available right now.",
      error: "Something went wrong. Try again.",
    } as Record<string, string>,
  },
};

type Merge = { token: string; summary: AccountSummary };
type Answer = { ok?: boolean; already?: boolean; error?: string; ref?: string; shown?: string; href?: string; merge?: Merge; ping?: number };

async function post(url: string, body: unknown): Promise<Answer> {
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return (await r.json().catch(() => ({ error: "error" }))) as Answer;
  } catch {
    return { error: "error" };
  }
}

type Tg = { requestContact?: (cb: (shared: boolean) => void) => void; initData?: string };
const tgApp = (): Tg | undefined => (typeof window === "undefined" ? undefined : (window as unknown as { Telegram?: { WebApp?: Tg } }).Telegram?.WebApp);

export function SignInMethods(p: { locale: Locale; logins: LoginRow[]; can: { phone: boolean; email: boolean; telegram: boolean } }) {
  const t = T[p.locale];
  const [open, setOpen] = useState<"phone" | "email" | "telegram" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [merge, setMerge] = useState<Merge | null>(null);
  const [inTelegram, setInTelegram] = useState(false);
  // Inside Telegram (launch data present): wait for Telegram's script, which offers "share my number".
  useEffect(() => {
    if (!telegramInitData()) return;
    void loadTelegramScript().then(() => setInTelegram(Boolean(tgApp()?.initData)));
  }, []);

  const has = (k: LoginRow["kind"]) => p.logins.some((l) => l.kind === k);
  const label = (l: LoginRow) => (l.kind === "phone" ? t.phone : l.kind === "telegram" ? t.telegram : t.email);
  const icon = (k: LoginRow["kind"]) => (k === "phone" ? "📱" : k === "telegram" ? "✈️" : "✉️");
  const done = (a: Answer) => {
    if (a.merge) return setMerge(a.merge);
    if (a.ok) {
      setNote(a.already ? t.already : t.added);
      window.setTimeout(() => window.location.reload(), 900);
    }
  };

  return (
    <section className="wc-card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }} aria-labelledby="h-logins">
      <h2 id="h-logins" style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
        {t.title}
      </h2>
      <p className="wc-signin-note" style={{ fontSize: 13 }}>
        {t.hint}
      </p>
      <ul className="wc-logins">
        {p.logins.map((l, i) => (
          <li key={i}>
            <span aria-hidden="true">{icon(l.kind)}</span>
            <span className="wc-grow">
              {label(l)}
              {l.label && (
                <bdi dir="ltr" style={{ color: "var(--wc-muted)", marginInlineStart: 8, fontSize: 13 }}>
                  {l.label}
                </bdi>
              )}
            </span>
            {l.primary && <span className="wc-login-main">{t.main}</span>}
            <span aria-hidden="true" style={{ color: "var(--wc-mint)" }}>
              ✓
            </span>
          </li>
        ))}
      </ul>

      {note && (
        <p className="wc-signin-note" role="status" style={{ color: "var(--wc-mint)" }}>
          {note}
        </p>
      )}

      {merge ? (
        <MergePrompt locale={p.locale} merge={merge} onCancel={() => setMerge(null)} />
      ) : open === "phone" ? (
        <PhoneAdd t={t} locale={p.locale} onDone={done} onCancel={() => setOpen(null)} />
      ) : open === "email" ? (
        <EmailAdd t={t} locale={p.locale} onCancel={() => setOpen(null)} />
      ) : open === "telegram" ? (
        <p className="wc-signin-note">{t.telegramOpened}</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {!has("phone") && inTelegram && tgApp()?.requestContact && (
            <button
              type="button"
              className="wc-btn wc-btn-tg"
              style={{ minHeight: 50, fontSize: 15 }}
              onClick={() =>
                tgApp()!.requestContact!((shared) => {
                  if (!shared) return;
                  setNote(t.shared);
                  // The bot gets the number and adds it; give it a moment, then show the new list.
                  window.setTimeout(() => window.location.reload(), 2500);
                })
              }
            >
              ✈️ {t.sharePhone}
            </button>
          )}
          {!has("phone") && p.can.phone && (
            <button type="button" className="wc-btn wc-btn-ghost" style={{ minHeight: 50, fontSize: 15 }} onClick={() => setOpen("phone")}>
              📱 {t.addPhone}
            </button>
          )}
          {!has("telegram") && p.can.telegram && !inTelegram && (
            <button
              type="button"
              className="wc-btn wc-btn-ghost"
              style={{ minHeight: 50, fontSize: 15 }}
              onClick={async () => {
                const a = await post("/api/account/link/telegram", {});
                if (a.href) {
                  setOpen("telegram");
                  window.location.href = a.href;
                } else setNote(t.errors[a.error ?? "error"] ?? t.errors.error);
              }}
            >
              ✈️ {t.connectTelegram}
            </button>
          )}
          {!has("email") && p.can.email && (
            <button type="button" className="wc-btn wc-btn-ghost" style={{ minHeight: 50, fontSize: 15 }} onClick={() => setOpen("email")}>
              ✉️ {t.addEmail}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

type Copy = (typeof T)["en"];

function PhoneAdd({ t, locale, onDone, onCancel }: { t: Copy; locale: Locale; onDone: (a: Answer) => void; onCancel: () => void }) {
  const [phone, setPhone] = useState("");
  const [sent, setSent] = useState<{ ref: string; shown: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    if (!sent) {
      const a = await post("/api/account/link/phone/send", { phone, lang: locale });
      setBusy(false);
      if (a.ok && a.ref) setSent({ ref: a.ref, shown: a.shown ?? "" });
      else setError(t.errors[a.error ?? "error"] ?? t.errors.error);
      return;
    }
    const a = await post("/api/account/link/phone/check", { ref: sent.ref, code });
    setBusy(false);
    if (a.ok || a.merge) onDone(a);
    else setError(t.errors[a.error ?? "error"] ?? t.errors.error);
  };
  return (
    <form
      className="wc-signin-form"
      onSubmit={(e) => {
        e.preventDefault();
        void run();
      }}
    >
      {!sent ? (
        <input type="tel" inputMode="tel" autoComplete="tel" dir="ltr" required autoFocus value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+971 50 123 4567" aria-label={t.phone} />
      ) : (
        <>
          <p className="wc-signin-note">
            {t.codeSent("")}
            <bdi dir="ltr">{sent.shown}</bdi>
          </p>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            dir="ltr"
            required
            autoFocus
            className="wc-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
            aria-label="Code"
          />
        </>
      )}
      {error && (
        <p className="wc-signin-error" role="alert">
          {error}
        </p>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" className="wc-btn" style={{ minHeight: 48, fontSize: 15, flex: 1 }} disabled={busy}>
          {busy ? t.busy : sent ? t.confirm : t.sendCode}
        </button>
        <button type="button" className="wc-btn wc-btn-ghost" style={{ minHeight: 48, fontSize: 15 }} onClick={onCancel}>
          {t.cancel}
        </button>
      </div>
    </form>
  );
}

function EmailAdd({ t, locale, onCancel }: { t: Copy; locale: Locale; onCancel: () => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (sent) return <p className="wc-signin-note">✉️ {t.linkSent}</p>;
  return (
    <form
      className="wc-signin-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const a = await post("/api/account/link/email", { email, lang: locale });
        setBusy(false);
        if (a.ok) setSent(true);
        else setError(t.errors[a.error ?? "error"] ?? t.errors.error);
      }}
    >
      <input type="email" inputMode="email" autoComplete="email" dir="ltr" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" aria-label={t.email} />
      {error && (
        <p className="wc-signin-error" role="alert">
          {error}
        </p>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" className="wc-btn" style={{ minHeight: 48, fontSize: 15, flex: 1 }} disabled={busy}>
          {busy ? t.busy : t.sendLink}
        </button>
        <button type="button" className="wc-btn wc-btn-ghost" style={{ minHeight: 48, fontSize: 15 }} onClick={onCancel}>
          {t.cancel}
        </button>
      </div>
    </form>
  );
}

const M = {
  ar: {
    title: "هذه الطريقة مرتبطة بحساب آخر",
    body: "ندمج الحساب الآخر في هذا الحساب: ينتقل كل ما فيه إلى هنا، ويُغلق الحساب الآخر. لا يمكن التراجع عن الدمج.",
    has: "في الحساب الآخر:",
    ping: (n: number) => `${n} بينج`,
    passes: (n: number) => `${n} باقة مشاهدة`,
    episodes: (n: number) => `${n} حلقة مفتوحة`,
    watched: (n: number) => `${n} حلقة شاهدتها`,
    merge: "ادمج في هذا الحساب",
    cancel: "ليس الآن",
    done: (n: number) => (n > 0 ? `تم الدمج ✅ انتقل ${n} بينج إلى هذا الحساب.` : "تم الدمج ✅"),
    expired: "انتهت مهلة الدمج. أضف الطريقة من جديد.",
    busy: "لحظة…",
  },
  en: {
    title: "This is already linked to another account",
    body: "We'll merge the other account into this one: everything in it moves here, and the other account closes. A merge can't be undone.",
    has: "The other account has:",
    ping: (n: number) => `${n} Ping`,
    passes: (n: number) => `${n} pass${n === 1 ? "" : "es"}`,
    episodes: (n: number) => `${n} unlocked episode${n === 1 ? "" : "s"}`,
    watched: (n: number) => `${n} episode${n === 1 ? "" : "s"} watched`,
    merge: "Merge into this account",
    cancel: "Not now",
    done: (n: number) => (n > 0 ? `Merged ✅ ${n} Ping moved to this account.` : "Merged ✅"),
    expired: "The merge request expired. Add the sign-in method again.",
    busy: "One moment…",
  },
};

export function MergePrompt({ locale, merge, onCancel, after = "/me" }: { locale: Locale; merge: Merge; onCancel: () => void; after?: string }) {
  const t = M[locale];
  const s = merge.summary;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const items = [s.ping > 0 && t.ping(s.ping), s.passes > 0 && t.passes(s.passes), s.episodes > 0 && t.episodes(s.episodes), s.watched > 0 && t.watched(s.watched)].filter(Boolean) as string[];
  return (
    <div className="wc-merge" role="alertdialog" aria-labelledby="merge-title">
      <strong id="merge-title">{t.title}</strong>
      <p className="wc-signin-note">{t.body}</p>
      {items.length > 0 && (
        <p className="wc-signin-note">
          {t.has} {items.join(" · ")}
        </p>
      )}
      {msg ? (
        <p className="wc-signin-note" role="status" style={{ color: "var(--wc-mint)" }}>
          {msg}
        </p>
      ) : (
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className="wc-btn"
            style={{ minHeight: 48, fontSize: 15, flex: 1 }}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const a = await post("/api/account/merge", { token: merge.token });
              setBusy(false);
              if (a.ok) {
                setMsg(t.done(a.ping ?? 0));
                window.setTimeout(() => window.location.replace(after), 1400);
              } else setMsg(t.expired);
            }}
          >
            {busy ? t.busy : t.merge}
          </button>
          <button type="button" className="wc-btn wc-btn-ghost" style={{ minHeight: 48, fontSize: 15 }} onClick={onCancel}>
            {t.cancel}
          </button>
        </div>
      )}
    </div>
  );
}
