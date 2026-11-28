"use client";

// The paid three-card reading: an optional question, the price, then the three cards and the reflection text.

import Link from "next/link";
import { useState } from "react";
import { cardById, SPREAD } from "@/lib/daily/tarot";
import { playCopy } from "@/lib/play/copy";
import type { Reading } from "@/lib/play/store";
import { postJson } from "./post";

export function FortuneReading({ locale, price, past }: { locale: "ar" | "en"; price: number; past: Reading[] }) {
  const t = playCopy(locale);
  const ar = locale === "ar";
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"" | "need_ping" | "other" | "slow">("");
  const [readings, setReadings] = useState(past);

  const buy = async () => {
    setBusy(true);
    setError("");
    const r = await postJson<{ reading: Reading }>("/api/play/reading", { question });
    setBusy(false);
    if (!r.ok) {
      setError(r.status === 402 ? "need_ping" : r.status === 429 ? "slow" : "other");
      return;
    }
    setReadings([r.data.reading, ...readings]);
    setQuestion("");
  };

  return (
    <div className="pl-section">
      <section className="pl-card" style={{ ["--pl-accent" as string]: "#f5c242" }}>
        <div className="pl-section" style={{ gap: 10 }}>
          <h2 className="pl-title">🃏 {t.fortuneTitle}</h2>
          <label className="pl-muted" htmlFor="reading-q">{t.readingAsk}</label>
          <input id="reading-q" className="pl-input" maxLength={300} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={t.readingPlaceholder} />
          <button type="button" className="pl-btn pl-btn-gold" onClick={buy} disabled={busy}>
            {busy ? t.readingBusy : t.readingCta(price)}
          </button>
          {error === "need_ping" ? (
            <p className="pl-muted" role="alert">
              {t.needPing} · <Link className="wc-link" href="/store">{t.getPing}</Link>
            </p>
          ) : error ? (
            <p className="pl-muted" role="alert">{error === "slow" ? t.slowDown : t.failed}</p>
          ) : null}
        </div>
      </section>

      {readings.map((r, i) => (
        <section key={r.id} className={`pl-card${i === 0 && busy === false ? " pl-pop" : ""}`} style={{ ["--pl-accent" as string]: "#f5c242" }}>
          {r.question ? <p className="pl-muted" style={{ marginBottom: 10 }}>“{r.question}”</p> : null}
          <div className="pl-mini-cards">
            {r.cards.map((c, n) => {
              const card = cardById(c.card);
              return (
                <div key={n} className="pl-mini">
                  <span className="pl-big" style={c.reversed ? { transform: "rotate(180deg)" } : undefined} aria-hidden="true">{card.emoji}</span>
                  <b style={{ color: "#f5c242" }}>{ar ? card.nameAr : card.nameEn}</b>
                  <span className="pl-muted">{ar ? SPREAD[n].ar : SPREAD[n].en}</span>
                </div>
              );
            })}
          </div>
          <p style={{ marginTop: 12, whiteSpace: "pre-wrap", fontSize: 15 }}>{r.text}</p>
        </section>
      ))}
      <p className="pl-note">{t.disclaimer}</p>
    </div>
  );
}
