"use client";

// Chat with one AI person: history (30 days), starter chips, the day's free messages, then Ping per message.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { playCopy } from "@/lib/play/copy";
import type { ChatState } from "@/lib/play/store";
import { postJson } from "./post";

type P = { slug: string; greeting: string; starters: string[]; color: string; emoji: string };

export function PersonChat({ person, initial, locale }: { person: P; initial: ChatState; locale: "ar" | "en" }) {
  const t = playCopy(locale);
  const [state, setState] = useState(initial);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>(initial.messages.length ? [] : person.starters);
  const [error, setError] = useState<"" | "need_ping" | "slow" | "other">("");
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [state.messages.length, pending]);

  const send = async (raw: string) => {
    const msg = raw.trim();
    if (!msg || pending) return;
    setPending(msg);
    setText("");
    setError("");
    setSuggestions([]);
    const r = await postJson<{ state: ChatState; suggestions: string[] }>("/api/play/person", { slug: person.slug, text: msg });
    setPending(null);
    if (!r.ok) {
      setError(r.status === 402 ? "need_ping" : r.status === 429 ? "slow" : "other");
      setText(msg);
      return;
    }
    setState(r.data.state);
    setSuggestions(r.data.suggestions);
  };

  const cantAfford = state.cost > 0 && state.balance < state.cost;

  return (
    <div className="pl-section" style={{ ["--pl-accent" as string]: person.color }}>
      <div className="pl-chat" aria-live="polite">
        <div className="pl-bubble pl-bubble-them">{person.greeting}</div>
        {state.messages.map((m, i) => (
          <div key={i} className={`pl-bubble ${m.role === "user" ? "pl-bubble-me" : "pl-bubble-them"}`}>{m.content}</div>
        ))}
        {pending ? (
          <>
            <div className="pl-bubble pl-bubble-me">{pending}</div>
            <div className="pl-typing">{person.emoji} …</div>
          </>
        ) : null}
        <div ref={end} />
      </div>

      {suggestions.length ? (
        <div className="pl-chips">
          {suggestions.map((s) => (
            <button key={s} type="button" onClick={() => send(s)} disabled={Boolean(pending) || cantAfford}>
              {s}
            </button>
          ))}
        </div>
      ) : null}

      <p className="pl-muted">
        {state.freeLeft > 0 ? t.freeLeft(state.freeLeft) : t.costNext(state.cost)}
        {cantAfford || error === "need_ping" ? (
          <>
            {" · "}
            {t.needPing} · <Link className="wc-link" href="/store">{t.getPing}</Link>
          </>
        ) : null}
        {error === "slow" ? ` · ${t.slowDown}` : error === "other" ? ` · ${t.failed}` : null}
      </p>

      <form
        className="pl-composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <textarea
          rows={1}
          value={text}
          maxLength={600}
          placeholder={t.typeMessage}
          aria-label={t.typeMessage}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(text);
            }
          }}
        />
        <button type="submit" className="pl-send" disabled={!text.trim() || Boolean(pending) || cantAfford} aria-label={t.send}>
          {locale === "ar" ? "↩" : "↪"}
        </button>
      </form>
    </div>
  );
}
