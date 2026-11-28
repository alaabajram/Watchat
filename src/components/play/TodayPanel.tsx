"use client";

// Today: the card of the day (tap to turn it over), the daily question (one tap, see the split) and the
// horoscope for the viewer's sign (pick it once). Entertainment and reflection only — the line says so.

import Link from "next/link";
import { useState } from "react";
import { DAILY_QUESTIONS, SIGNS, signDates, type Sign } from "@/lib/daily/daily";
import { cardById, cardMeaning } from "@/lib/daily/tarot";
import { playCopy } from "@/lib/play/copy";
import type { Today } from "@/lib/play/store";
import { postJson } from "./post";
import { ShareImageButton } from "./ShareImage";
import { ShareLink } from "./ShareLink";

export function TodayPanel({ initial, locale, compact = false }: { initial: Today; locale: "ar" | "en"; compact?: boolean }) {
  const t = playCopy(locale);
  const ar = locale === "ar";
  const [today, setToday] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [pickingSign, setPickingSign] = useState(false);

  const act = async (body: Record<string, unknown>) => {
    if (busy) return;
    setBusy(true);
    const r = await postJson<{ today: Today }>("/api/play/today", body);
    setBusy(false);
    if (r.ok) setToday(r.data.today);
  };

  const card = cardById(today.card.card);
  const q = DAILY_QUESTIONS[today.question.index];
  const qPct = (i: number) => today.question.results?.rows.find((r) => r.id === String(i))?.pct ?? 0;
  const sign = today.sign ? SIGNS.find((s) => s.key === today.sign)! : null;

  return (
    <div className="pl-section" style={{ gap: 16 }}>
      {/* Card of the day */}
      <section className="pl-card" style={{ ["--pl-accent" as string]: "#f5c242" }} aria-label={t.cardOfDay}>
        <div className="pl-row">
          <h2 className="pl-title">🔮 {t.cardOfDay}</h2>
          {today.card.drawn && today.card.reversed ? <span className="pl-tag">{t.reversed}</span> : null}
        </div>
        <button type="button" className="pl-tarot" data-open={today.card.drawn} onClick={() => !today.card.drawn && act({ action: "draw" })} aria-label={t.drawCard} style={{ background: "none", border: 0, display: "block", cursor: today.card.drawn ? "default" : "pointer" }}>
          <div className="pl-tarot-inner">
            <div className="pl-tarot-face pl-tarot-back" />
            <div className="pl-tarot-face pl-tarot-front" data-rev={today.card.reversed}>
              <span className="pl-big" aria-hidden="true">{card.emoji}</span>
              <span className="pl-tarot-name">{ar ? card.nameAr : card.nameEn}</span>
              <span className="pl-muted">{t.wordToday}: <b style={{ color: "var(--wc-ink)" }}>{ar ? card.wordAr : card.wordEn}</b></span>
            </div>
          </div>
        </button>
        {today.card.drawn ? (
          <div className="pl-section pl-pop" style={{ gap: 10 }}>
            <p style={{ fontSize: 16, textAlign: "center" }}>{cardMeaning(card, today.card.reversed, locale)}</p>
            {!compact ? (
              <div className="pl-row" style={{ justifyContent: "center", flexWrap: "wrap" }}>
                <ShareLink path="/today" locale={locale} event="card_share" text={ar ? `بطاقتي اليوم: ${card.nameAr} ${card.emoji} — كلمتي «${card.wordAr}». وش بطاقتك؟` : `My card today: ${card.nameEn} ${card.emoji} — my word is “${card.wordEn}”. What's yours?`} />
                <ShareImageButton
                  locale={locale}
                  file="watchat-card"
                  event="card_share_image"
                  card={{ kicker: t.cardOfDay, emoji: card.emoji, title: `${ar ? card.nameAr : card.nameEn} · ${ar ? card.wordAr : card.wordEn}`, body: cardMeaning(card, today.card.reversed, locale), accent: "#f5c242", footer: `watchat · ${t.disclaimer}` }}
                />
              </div>
            ) : null}
          </div>
        ) : (
          <button type="button" className="pl-btn pl-btn-gold" style={{ width: "100%" }} onClick={() => act({ action: "draw" })} disabled={busy}>
            {t.drawCard}
          </button>
        )}
      </section>

      {/* Daily question */}
      <section className="pl-card" style={{ ["--pl-accent" as string]: "#31e5a0" }} aria-label={t.dailyQuestion}>
        <p className="pl-muted">{t.dailyQuestion}</p>
        <h2 className="pl-title" style={{ margin: "4px 0 12px" }}>{ar ? q.ar : q.en}</h2>
        <div className="pl-options">
          {q.options.map((o, i) => (
            <button key={i} type="button" className="pl-opt" disabled={today.question.answer !== null || busy} onClick={() => act({ action: "question", pick: i })} data-mine={today.question.answer === i}>
              {today.question.results ? <span className="pl-bar" style={{ width: `${qPct(i)}%` }} aria-hidden="true" /> : null}
              <span>{ar ? o.ar : o.en}</span>
              {today.question.results ? <span className="pl-pct">{qPct(i)}%</span> : null}
            </button>
          ))}
        </div>
        {today.question.results ? (
          <div className="pl-row" style={{ marginTop: 8 }}>
            <p className="pl-muted">{t.people(today.question.results.total)}</p>
            {!compact ? (
              <ShareImageButton
                locale={locale}
                file="watchat-question"
                event="question_share_image"
                card={{ kicker: t.dailyQuestion, title: ar ? q.ar : q.en, accent: "#31e5a0", bars: q.options.map((o, i) => ({ label: ar ? o.ar : o.en, pct: qPct(i), mine: today.question.answer === i })), footer: `watchat · ${t.tagline}` }}
              />
            ) : null}
          </div>
        ) : null}
      </section>

      {/* Horoscope */}
      <section className="pl-card" style={{ ["--pl-accent" as string]: "#7c5cff" }} aria-label={t.horoscopeTitle}>
        {sign && today.horoscope && !pickingSign ? (
          <div className="pl-section" style={{ gap: 10 }}>
            <div className="pl-row">
              <h2 className="pl-title">
                <span aria-hidden="true">{sign.symbol}</span> {ar ? sign.ar : sign.en}
              </h2>
              <button type="button" className="wc-link" style={{ background: "none", border: 0, font: "inherit", cursor: "pointer" }} onClick={() => setPickingSign(true)}>
                {t.changeSign}
              </button>
            </div>
            <p style={{ fontSize: 16 }}>{ar ? today.horoscope.ar : today.horoscope.en}</p>
            <div className="pl-facts">
              <span className="pl-tag">{t.lucky}: {today.horoscope.luckyNumber}</span>
              {(ar ? today.horoscope.moodAr : today.horoscope.moodEn) ? <span className="pl-tag">{t.mood}: {ar ? today.horoscope.moodAr : today.horoscope.moodEn}</span> : null}
            </div>
            {compact ? (
              <Link href="/horoscope" className="wc-link">{t.horoscope} →</Link>
            ) : (
              <div className="pl-row" style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
                <ShareLink path="/horoscope" locale={locale} event="horoscope_share" text={ar ? `برجي ${sign.ar} ${sign.symbol} اليوم: ${today.horoscope.ar}` : `${sign.en} ${sign.symbol} today: ${today.horoscope.en}`} />
                <ShareImageButton
                  locale={locale}
                  file={`watchat-${sign.key}`}
                  event="horoscope_share_image"
                  card={{ kicker: t.horoscopeTitle, emoji: sign.symbol, title: ar ? sign.ar : sign.en, body: ar ? today.horoscope.ar : today.horoscope.en, accent: "#7c5cff", footer: `watchat · ${t.disclaimer}` }}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="pl-section" style={{ gap: 10 }}>
            <h2 className="pl-title">✨ {t.pickSign}</h2>
            <p className="pl-muted">{t.pickSignHint}</p>
            <div className="pl-signs">
              {SIGNS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  className="pl-sign"
                  aria-pressed={today.sign === s.key}
                  title={signDates(s.key as Sign, locale)}
                  disabled={busy}
                  onClick={async () => {
                    await act({ action: "sign", sign: s.key });
                    setPickingSign(false);
                  }}
                >
                  <b aria-hidden="true">{s.symbol}</b>
                  {ar ? s.ar : s.en}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
      <p className="pl-note">{t.disclaimer}</p>
    </div>
  );
}
