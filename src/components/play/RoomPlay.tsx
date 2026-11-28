"use client";

// One room's round: the question, the answers laid out for the mechanic, then the results (bars, the right
// answer, the guest's reply or the side's argument) and a share button.

import { useState } from "react";
import { shareLine } from "@/lib/rooms/engine";
import { playCopy } from "@/lib/play/copy";
import type { RoomView } from "@/lib/play/store";
import { postJson } from "./post";
import { ShareLink } from "./ShareLink";

export function RoomPlay({ initial, locale }: { initial: RoomView; locale: "ar" | "en" }) {
  const t = playCopy(locale);
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [rewarded, setRewarded] = useState(0);
  const [error, setError] = useState("");
  const { room, round } = view;
  const ar = locale === "ar";
  const L = (a: string, e: string) => (ar ? a || e : e || a);

  if (!round) return <p className="pl-sub">{t.noRound}</p>;

  const answered = Boolean(view.myAnswer);
  const pick = async (option: string) => {
    if (answered || busy) return;
    setBusy(option);
    setError("");
    const r = await postJson<{ view: RoomView; rewarded: number }>("/api/play/room", { slug: room.slug, option });
    setBusy(null);
    if (!r.ok) {
      if (r.status === 401) window.location.reload();
      setError(r.error === "slow_down" ? t.slowDown : t.failed);
      return;
    }
    setView(r.data.view);
    setRewarded(r.data.rewarded);
  };

  const pct = (id: string) => view.results?.rows.find((r) => r.id === id)?.pct ?? 0;
  const layout = room.mechanic === "would_you_rather" || room.mechanic === "debate" ? "pl-wyr" : room.mechanic === "opinion" ? "pl-scale" : "pl-options";
  const mine = round.options.find((o) => o.id === view.myAnswer);
  const right = round.options.find((o) => o.correct);
  const clues = ar ? round.extra.cluesAr : round.extra.cluesEn;

  return (
    <div className="pl-section" style={{ ["--pl-accent" as string]: room.color }}>
      <h2 className="pl-h1" style={{ fontSize: 22 }}>{L(round.promptAr, round.promptEn)}</h2>

      {clues?.length ? (
        <div className="pl-clues">
          {clues.map((c, i) => (
            <div key={i} className="pl-clue">
              <b>{t.clue(i + 1)}</b>
              {c}
            </div>
          ))}
        </div>
      ) : null}

      <div className={layout}>
        {round.options.map((o) => {
          const isMine = o.id === view.myAnswer;
          const isRight = answered && room.mechanic !== "poll" && o.correct === true;
          return (
            <button key={o.id} type="button" className="pl-opt" disabled={answered || Boolean(busy)} onClick={() => pick(o.id)} data-mine={isMine} data-right={isRight} aria-pressed={isMine}>
              {view.showResults ? <span className="pl-bar" style={{ width: `${pct(o.id)}%` }} aria-hidden="true" /> : null}
              <span>{busy === o.id ? "…" : L(o.ar, o.en)}</span>
              {view.showResults ? <span className="pl-pct">{pct(o.id)}%</span> : null}
            </button>
          );
        })}
      </div>

      {error ? <p className="pl-muted" role="alert">{error}</p> : null}

      {answered ? (
        <div className="pl-section pl-pop">
          {right ? <p className="pl-title">{view.correct ? t.right : t.wrong}{rewarded ? ` · ${t.rewarded(rewarded)}` : ""}</p> : null}
          {mine && (mine.revealAr || mine.revealEn) ? <div className="pl-reveal">{L(mine.revealAr ?? "", mine.revealEn ?? "")}</div> : null}
          {right && (round.extra.explainAr || round.extra.explainEn) ? <div className="pl-reveal">{L(round.extra.explainAr ?? "", round.extra.explainEn ?? "")}</div> : null}
          {!view.showResults ? <p className="pl-muted">{t.resultsTomorrow}</p> : <p className="pl-muted">{t.people(view.results?.total ?? 0)}</p>}
          <ShareLink path={`/rooms/${room.slug}`} locale={locale} event="room_share" text={view.results && view.myAnswer ? shareLine(round, view.myAnswer, view.results.rows, locale) : L(round.promptAr, round.promptEn)} />
        </div>
      ) : null}
    </div>
  );
}
