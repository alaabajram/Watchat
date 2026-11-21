"use client";

// The Watchat assistant chat on the web: quick buttons, free text, and answers as series and offer cards.
// It only helps with Watchat: finding series, offers, continuing, how it works (see lib/assistant/engine.ts).

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { AssistantAnswer } from "@/lib/assistant/run";
import { CHIP_LABEL, MAX_MESSAGE_CHARS, type Chip, type Offer } from "@/lib/assistant/engine";
import { AgentIcon } from "./AgentIcon";
import { AlertsOptIn } from "./AlertsOptIn";
import { PingIcon } from "@/components/brand/PingIcon";

type Locale = "ar" | "en";
type Item = { from: "viewer"; text: string } | { from: "bot"; answer: AssistantAnswer } | { from: "error"; text: string };

const T = {
  ar: {
    title: "مساعد واتشات",
    subtitle: "مسلسلات، بحث، وعروض",
    placeholder: "اكتب اسم مسلسل أو نوع قصة…",
    send: "إرسال",
    watch: "شاهد",
    resume: (n: number) => `كمّل الحلقة ${n}`,
    episodes: (n: number) => `${n} حلقة`,
    coins: (n: number) => `${n} بينج`,
    weekly: "باقة أسبوعية · كل المسلسلات",
    yearly: "باقة سنوية · كل المسلسلات",
    bonus: (n: number) => `+${n} هدية`,
    best: "أفضل قيمة",
    pass: "تذكرة المسلسل",
    buy: "اشترِ",
    error: "صار خطأ بسيط. جرّب مرة ثانية.",
    signedOut: "انتهت الجلسة. افتح واتشات من رابطك في واتساب.",
    thinking: "لحظة…",
    scope: "المساعد يساعدك في مسلسلات واتشات فقط.",
  },
  en: {
    title: "Watchat assistant",
    subtitle: "Series, search and offers",
    placeholder: "Type a series name or a kind of story…",
    send: "Send",
    watch: "Watch",
    resume: (n: number) => `Continue episode ${n}`,
    episodes: (n: number) => `${n} episodes`,
    coins: (n: number) => `${n} Ping`,
    weekly: "Weekly pass · every series",
    yearly: "Yearly pass · every series",
    bonus: (n: number) => `+${n} bonus`,
    best: "Best value",
    pass: "Series pass",
    buy: "Buy",
    error: "Something went wrong. Try again.",
    signedOut: "Your session ended. Open Watchat from your link in WhatsApp.",
    thinking: "One moment…",
    scope: "The assistant only helps with Watchat series.",
  },
} as const;

const money = (v: number, currency: string, locale: Locale) =>
  currency === "XTR"
    ? `${Math.round(v).toLocaleString(locale === "ar" ? "ar-AE" : "en-US")} ⭐` // Telegram Stars
    : new Intl.NumberFormat(locale === "ar" ? "ar-AE" : "en-AE", { style: "currency", currency, maximumFractionDigits: v % 1 ? 2 : 0 }).format(v);

const STORE_KEY = "wc-assistant";

export function AssistantChat({ locale, first }: { locale: Locale; first: AssistantAnswer }) {
  const t = T[locale];
  const [items, setItems] = useState<Item[]>([{ from: "bot", answer: first }]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  // Keep the conversation for this tab only (nothing is stored on our side).
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORE_KEY);
      if (saved) setItems(JSON.parse(saved) as Item[]);
    } catch {
      /* storage unavailable */
    }
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify(items.slice(-30)));
    } catch {
      /* storage unavailable */
    }
    bottom.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [items]);

  async function send(input: { message?: string; chip?: Chip }, label: string) {
    if (busy) return;
    setBusy(true);
    setItems((x) => [...x, { from: "viewer", text: label }]);
    try {
      const r = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
      if (r.status === 401) throw new Error("signed_out");
      if (!r.ok) throw new Error("failed");
      const answer = (await r.json()) as AssistantAnswer;
      setItems((x) => [...x, { from: "bot", answer }]);
    } catch (e) {
      setItems((x) => [...x, { from: "error", text: e instanceof Error && e.message === "signed_out" ? t.signedOut : t.error }]);
    } finally {
      setBusy(false);
    }
  }

  const last = [...items].reverse().find((i): i is Extract<Item, { from: "bot" }> => i.from === "bot");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <AlertsOptIn locale={locale} compact />
      <div role="log" aria-live="polite" aria-label={t.title} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {items.map((it, i) =>
          it.from === "viewer" ? (
            <div key={i} dir="auto" style={{ alignSelf: "flex-end", maxWidth: "82%", background: "var(--wc-mint)", color: "var(--wc-mint-ink)", borderRadius: "20px 20px 6px 20px", padding: "10px 14px", fontSize: 16, fontWeight: 500 }}>
              {it.text}
            </div>
          ) : it.from === "error" ? (
            <div key={i} style={{ alignSelf: "flex-start", color: "var(--wc-coral-text)", fontSize: 15 }}>
              {it.text}
            </div>
          ) : (
            <BotAnswer key={i} answer={it.answer} locale={locale} />
          ),
        )}
        {busy && (
          <div style={{ alignSelf: "flex-start", background: "var(--wc-card)", borderRadius: "20px 20px 20px 6px", padding: "10px 14px", color: "var(--wc-muted)", fontSize: 15 }}>{t.thinking}</div>
        )}
        <div ref={bottom} />
      </div>

      {/* Quick buttons (answered without AI) and the message box stay above the bottom bar. */}
      <div style={{ position: "sticky", bottom: "calc(84px + env(safe-area-inset-bottom))", display: "flex", flexDirection: "column", gap: 8, paddingTop: 8, background: "linear-gradient(to bottom, rgba(244,242,238,0), var(--wc-bg) 30%)" }}>
      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2 }} className="wc-scroller">
        {(last?.answer.chips ?? []).map((c) => (
          <button key={c} type="button" className="wc-chip" disabled={busy} onClick={() => send({ chip: c }, CHIP_LABEL[c][locale])} style={{ cursor: "pointer", whiteSpace: "nowrap", font: "inherit" }}>
            {CHIP_LABEL[c][locale]}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const m = text.trim();
          if (!m) return;
          setText("");
          void send({ message: m }, m);
        }}
        style={{ display: "flex", gap: 8, background: "var(--wc-card)", borderRadius: 22, padding: 6, boxShadow: "0 10px 30px rgba(0,0,0,0.4)", border: "1px solid var(--wc-line)" }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={MAX_MESSAGE_CHARS}
          placeholder={t.placeholder}
          aria-label={t.placeholder}
          dir="auto"
          enterKeyHint="send"
          style={{ flex: 1, minWidth: 0, border: 0, outline: "none", background: "transparent", font: "inherit", fontSize: 16, padding: "10px 12px", color: "var(--wc-ink)" }}
        />
        <button type="submit" disabled={busy || !text.trim()} aria-label={t.send} style={{ border: 0, borderRadius: 16, background: "var(--wc-mint)", color: "var(--wc-mint-ink)", fontWeight: 700, padding: "0 18px", font: "inherit", cursor: "pointer", opacity: busy || !text.trim() ? 0.5 : 1 }}>
          {t.send}
        </button>
      </form>
      </div>
      <p style={{ margin: 0, textAlign: "center", fontSize: 12, color: "var(--wc-muted)" }}>{t.scope}</p>
    </div>
  );
}

function BotAnswer({ answer, locale }: { answer: AssistantAnswer; locale: Locale }) {
  const t = T[locale];
  return (
    <div style={{ alignSelf: "flex-start", width: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ alignSelf: "flex-start", display: "flex", alignItems: "flex-end", gap: 8, maxWidth: "92%" }}>
        <AgentIcon height={28} />
        <div style={{ background: "var(--wc-card)", borderRadius: "20px 20px 20px 6px", padding: "10px 14px", fontSize: 16, lineHeight: 1.5, boxShadow: "none", border: "1px solid var(--wc-line)" }}>{answer.text}</div>
      </div>

      {answer.series.length > 0 && (
        <div style={{ display: "flex", gap: 10, overflowX: "auto" }} className="wc-scroller">
          {answer.series.map((s) => {
            const title = locale === "en" ? s.titleEn : s.titleAr;
            const tag = locale === "en" ? (s.taglineEn ?? s.taglineAr) : (s.taglineAr ?? s.taglineEn);
            const href = s.resume ? `/watch/${s.code}/${s.resume}` : `/series/${s.code}`;
            return (
              <Link key={s.code} href={href} className="wc-card" style={{ flex: "0 0 132px", display: "flex", flexDirection: "column", overflow: "hidden", padding: 0, background: "var(--wc-card)", textDecoration: "none", color: "inherit" }}>
                {s.posterUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.posterUrl} alt="" style={{ width: "100%", aspectRatio: "3 / 4", objectFit: "cover", display: "block" }} />
                ) : (
                  <div style={{ aspectRatio: "3 / 4", background: "var(--wc-night-2)" }} />
                )}
                <div style={{ padding: "10px 12px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
                  <strong style={{ fontSize: 14, lineHeight: 1.3 }}>{title}</strong>
                  {tag && <span style={{ fontSize: 13, color: "var(--wc-muted)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{tag}</span>}
                  <span style={{ marginTop: 4, fontSize: 14, fontWeight: 700, color: "var(--wc-mint-text)" }}>▶ {s.resume ? t.resume(s.resume) : `${t.watch} · ${t.episodes(s.total)}`}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {answer.offers.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {answer.offers.map((o) => (
            <OfferCard key={o.kind === "pack" ? o.id : o.kind === "plan" ? o.plan : `pass-${o.seriesCode}`} offer={o} locale={locale} />
          ))}
        </div>
      )}

      {answer.helpItems.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {answer.helpItems.map((h) => (
            <details key={h.q} className="wc-card" style={{ background: "var(--wc-card)", padding: "12px 14px" }} open={answer.helpItems.length === 1}>
              <summary style={{ fontWeight: 600, cursor: "pointer" }}>{h.q}</summary>
              <p style={{ margin: "8px 0 0", lineHeight: 1.55 }}>{h.a}</p>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

function OfferCard({ offer, locale }: { offer: Offer; locale: Locale }) {
  const t = T[locale];
  const isPack = offer.kind === "pack";
  return (
    <Link
      href={offer.kind === "pass" ? `/series/${offer.seriesCode}` : "/store?back=/assistant"}
      className="wc-card"
      style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--wc-card)", padding: 12, textDecoration: "none", color: "inherit" }}
    >
      <span aria-hidden="true" style={{ width: 44, height: 44, borderRadius: "50%", background: "rgba(245,179,35,0.16)", border: "1px solid rgba(245,179,35,0.4)", display: "grid", placeItems: "center", flex: "none", fontSize: 20 }}>
        {isPack ? <PingIcon size={30} /> : offer.kind === "plan" ? "⭐" : "🎟️"}
      </span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <strong style={{ fontSize: 16 }}>{offer.kind === "pack" ? t.coins(offer.coins + offer.bonus) : offer.kind === "plan" ? t[offer.plan] : `${t.pass} · ${locale === "en" ? offer.titleEn : offer.titleAr}`}</strong>
        <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {isPack && offer.bonus > 0 && <span className="wc-chip" style={{ fontSize: 12, padding: "2px 8px" }}>{t.bonus(offer.bonus)}</span>}
          {isPack && offer.best && <span className="wc-chip" style={{ fontSize: 12, padding: "2px 8px", background: "rgba(49,229,160,0.18)" }}>{t.best}</span>}
        </span>
      </span>
      <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{money(offer.price, offer.currency, locale)}</span>
    </Link>
  );
}
