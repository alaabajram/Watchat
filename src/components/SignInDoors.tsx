"use client";

// The one way into Watchat: every door on one screen. Chat apps first (the visitor's own app on top), then
// "Phone number" (a 6-digit code by SMS) and "Email" (a one-time link). Doors that aren't set up — or WhatsApp
// while it isn't sending — aren't shown. Every door ends in the same account and the same session.

import { useEffect, useRef, useState } from "react";
import type { Door } from "@/lib/signin/doors";
import { ChatIcon } from "./brand/icons";
import { TelegramSignIn } from "./TelegramSignIn";

type Locale = "ar" | "en";

const T = {
  ar: {
    whatsapp: "المتابعة عبر واتساب",
    telegram: "المتابعة عبر تيليجرام",
    phone: "المتابعة برقم الهاتف",
    email: "المتابعة بالبريد الإلكتروني",
    or: "أو",
    phoneLabel: "رقم الهاتف",
    phonePlaceholder: "+971 50 123 4567",
    sendCode: "أرسل الرمز",
    codeSentTo: (p: string) => `أرسلنا رمزًا من ٦ أرقام إلى ${p}`,
    codeLabel: "الرمز",
    verify: "تأكيد",
    changeNumber: "تغيير الرقم",
    resend: "أعد الإرسال",
    resendIn: (s: number) => `أعد الإرسال بعد ${s} ث`,
    emailLabel: "البريد الإلكتروني",
    emailPlaceholder: "name@example.com",
    sendLink: "أرسل رابط الدخول",
    linkSent: (e: string) => `أرسلنا رابط الدخول إلى ${e}. افتحه خلال ٣٠ دقيقة من هذا الجهاز.`,
    spam: "لم يصل؟ تحقّق من البريد غير المرغوب.",
    otherEmail: "بريد آخر",
    back: "رجوع",
    busy: "لحظة…",
    errors: {
      invalid_number: "تحقّق من الرقم مع رمز الدولة.",
      invalid_email: "تحقّق من البريد الإلكتروني.",
      blocked: "لا يمكننا إرسال رمز لهذا الرقم الآن. جرّب طريقة أخرى.",
      slow_down: "محاولات كثيرة. انتظر قليلًا ثم حاول مجددًا.",
      wrong_code: "الرمز غير صحيح.",
      expired: "انتهت صلاحية الرمز. اطلب رمزًا جديدًا.",
      use_telegram: "هذا الرقم مرتبط بحساب تيليجرام. ادخل عبر تيليجرام.",
      not_configured: "هذه الطريقة غير متاحة الآن.",
      error: "حدث خطأ. حاول مرة أخرى.",
    } as Record<string, string>,
  },
  en: {
    whatsapp: "Continue with WhatsApp",
    telegram: "Continue with Telegram",
    phone: "Continue with phone number",
    email: "Continue with email",
    or: "or",
    phoneLabel: "Phone number",
    phonePlaceholder: "+971 50 123 4567",
    sendCode: "Send code",
    codeSentTo: (p: string) => `We sent a 6-digit code to ${p}`,
    codeLabel: "Code",
    verify: "Confirm",
    changeNumber: "Change number",
    resend: "Send again",
    resendIn: (s: number) => `Send again in ${s}s`,
    emailLabel: "Email",
    emailPlaceholder: "name@example.com",
    sendLink: "Send sign-in link",
    linkSent: (e: string) => `We sent a sign-in link to ${e}. Open it within 30 minutes on this device.`,
    spam: "Not there? Check your spam folder.",
    otherEmail: "Use another email",
    back: "Back",
    busy: "One moment…",
    errors: {
      invalid_number: "Check the number, with the country code.",
      invalid_email: "Check the email address.",
      blocked: "We can't send a code to this number right now. Try another way.",
      slow_down: "Too many tries. Wait a little, then try again.",
      wrong_code: "That code isn't right.",
      expired: "That code has expired. Ask for a new one.",
      use_telegram: "This number belongs to a Telegram account. Sign in with Telegram.",
      not_configured: "This way isn't available right now.",
      error: "Something went wrong. Try again.",
    } as Record<string, string>,
  },
};

async function post(url: string, body: unknown): Promise<{ ok?: boolean; error?: string; to?: string; phone?: string; shown?: string }> {
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return (await r.json().catch(() => ({ error: "error" }))) as { ok?: boolean; error?: string };
  } catch {
    return { error: "error" };
  }
}

export function SignInDoors(p: { locale: Locale; doors: Door[]; waHref: string | null; tgHref: string | null; to: string; waLabel?: string; tgLabel?: string }) {
  const t = T[p.locale];
  const [open, setOpen] = useState<"phone" | "email" | null>(null);
  const chats = p.doors.filter((d) => d === "whatsapp" || d === "telegram");
  const others = p.doors.filter((d) => d === "phone" || d === "email");

  if (open === "phone") return <PhoneForm t={t} locale={p.locale} to={p.to} onBack={() => setOpen(null)} />;
  if (open === "email") return <EmailForm t={t} locale={p.locale} to={p.to} onBack={() => setOpen(null)} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {chats.map((d) =>
        d === "whatsapp" && p.waHref ? (
          <a key={d} className="wc-btn" href={p.waHref} style={{ minHeight: 58 }}>
            <ChatIcon />
            {p.waLabel ?? t.whatsapp}
          </a>
        ) : d === "telegram" ? (
          <TelegramSignIn key={d} href={p.tgHref} label={p.tgLabel ?? t.telegram} to={p.to} />
        ) : null,
      )}
      {chats.length > 0 && others.length > 0 && (
        <div className="wc-or" role="separator">
          <span>{t.or}</span>
        </div>
      )}
      {others.map((d) => (
        <button key={d} type="button" className="wc-btn wc-btn-ghost" style={{ minHeight: 54, fontSize: 16 }} onClick={() => setOpen(d as "phone" | "email")}>
          <span aria-hidden="true">{d === "phone" ? "📱" : "✉️"}</span>
          {d === "phone" ? t.phone : t.email}
        </button>
      ))}
    </div>
  );
}

type Copy = (typeof T)["en"];

function PhoneForm({ t, locale, to, onBack }: { t: Copy; locale: Locale; to: string; onBack: () => void }) {
  const [phone, setPhone] = useState("");
  const [sent, setSent] = useState<{ phone: string; shown: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const codeBox = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const id = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(id);
  }, [wait]);

  const send = async (number: string) => {
    setBusy(true);
    setError(null);
    const r = await post("/api/signin/phone/send", { phone: number, lang: locale });
    setBusy(false);
    if (!r.ok || !r.phone) return setError(t.errors[r.error ?? "error"] ?? t.errors.error);
    setSent({ phone: r.phone, shown: r.shown ?? r.phone });
    setCode("");
    setWait(30);
    window.setTimeout(() => codeBox.current?.focus(), 50);
  };

  const verify = async (value: string) => {
    if (!sent || busy) return;
    setBusy(true);
    setError(null);
    const r = await post("/api/signin/phone/check", { phone: sent.phone, code: value, to, lang: locale });
    if (r.ok && r.to) return window.location.replace(r.to);
    setBusy(false);
    setError(t.errors[r.error ?? "error"] ?? t.errors.error);
  };

  return (
    <form
      className="wc-signin-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (sent) void verify(code);
        else void send(phone);
      }}
    >
      {!sent ? (
        <label>
          {t.phoneLabel}
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            dir="ltr"
            required
            autoFocus
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={t.phonePlaceholder}
          />
        </label>
      ) : (
        <>
          <p className="wc-signin-note">
            {t.codeSentTo("")}
            <bdi dir="ltr">{sent.shown}</bdi>
          </p>
          <label>
            {t.codeLabel}
            <input
              ref={codeBox}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              dir="ltr"
              maxLength={8}
              required
              value={code}
              className="wc-code"
              onChange={(e) => {
                const v = e.target.value.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/\D/g, "").slice(0, 8);
                setCode(v);
                if (v.length === 6) void verify(v);
              }}
            />
          </label>
        </>
      )}
      {error && (
        <p className="wc-signin-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="wc-btn" disabled={busy} style={{ minHeight: 54 }}>
        {busy ? t.busy : sent ? t.verify : t.sendCode}
      </button>
      <div className="wc-signin-links">
        {sent ? (
          <>
            <button type="button" onClick={() => (setSent(null), setError(null))}>
              {t.changeNumber}
            </button>
            <button type="button" disabled={wait > 0 || busy} onClick={() => void send(sent.phone)}>
              {wait > 0 ? t.resendIn(wait) : t.resend}
            </button>
          </>
        ) : (
          <button type="button" onClick={onBack}>
            {t.back}
          </button>
        )}
      </div>
    </form>
  );
}

function EmailForm({ t, locale, to, onBack }: { t: Copy; locale: Locale; to: string; onBack: () => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (sent)
    return (
      <div className="wc-signin-form" role="status">
        <p className="wc-signin-note" style={{ fontSize: 16 }}>
          ✉️ {t.linkSent("")}
          <bdi dir="ltr">{sent}</bdi>
        </p>
        <p className="wc-signin-note">{t.spam}</p>
        <div className="wc-signin-links">
          <button type="button" onClick={() => (setSent(null), setEmail(""))}>
            {t.otherEmail}
          </button>
          <button type="button" onClick={onBack}>
            {t.back}
          </button>
        </div>
      </div>
    );

  return (
    <form
      className="wc-signin-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const r = await post("/api/signin/email/send", { email, to, lang: locale });
        setBusy(false);
        if (r.ok) setSent(email.trim());
        else setError(t.errors[r.error ?? "error"] ?? t.errors.error);
      }}
    >
      <label>
        {t.emailLabel}
        <input type="email" inputMode="email" autoComplete="email" dir="ltr" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t.emailPlaceholder} />
      </label>
      {error && (
        <p className="wc-signin-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="wc-btn" disabled={busy} style={{ minHeight: 54 }}>
        {busy ? t.busy : t.sendLink}
      </button>
      <div className="wc-signin-links">
        <button type="button" onClick={onBack}>
          {t.back}
        </button>
      </div>
    </form>
  );
}
