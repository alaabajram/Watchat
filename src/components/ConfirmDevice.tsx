"use client";

// P13 — "Confirm it's you". Shown before spending on a device that isn't trusted yet.
// Gets a code, opens WhatsApp with "CONFIRM <code>" ready to send, and waits until the bot confirms.

import { useEffect, useRef, useState } from "react";
import { webCopy, type Locale } from "@/lib/web-copy";

export function ConfirmDevice({ locale, onConfirmed, onCancel }: { locale: Locale; onConfirmed: () => void; onCancel?: () => void }) {
  const t = webCopy(locale);
  const [code, setCode] = useState<string | null>(null);
  const [waLink, setWaLink] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/session/confirm", { method: "POST" })
      .then((r) => r.json())
      .then((j: { trusted?: boolean; code?: string; waLink?: string | null }) => {
        if (!alive) return;
        if (j.trusted) return onConfirmed();
        if (!j.code) return setError(true);
        setCode(j.code);
        setWaLink(j.waLink ?? null);
        timer.current = setInterval(async () => {
          const s = (await fetch("/api/session/confirm").then((r) => r.json()).catch(() => ({}))) as { trusted?: boolean };
          if (s.trusted) {
            if (timer.current) clearInterval(timer.current);
            onConfirmed();
          }
        }, 3000);
      })
      .catch(() => setError(true));
    return () => {
      alive = false;
      if (timer.current) clearInterval(timer.current);
    };
  }, [onConfirmed]);

  return (
    <div className="sheet" role="dialog" aria-labelledby="confirm-title">
      <strong id="confirm-title">{t.confirmTitle}</strong>
      {error && <p className="muted">{t.error}</p>}
      {code && (
        <>
          <p style={{ margin: 0 }}>{t.confirmBody}</p>
          <p style={{ margin: 0, fontSize: 28, letterSpacing: 6, fontWeight: 700 }} dir="ltr">
            {code}
          </p>
          {waLink && (
            <a className="btn" href={waLink}>
              {t.confirmButton}
            </a>
          )}
          <p className="muted" style={{ margin: 0 }}>
            {t.confirmManual(code)}
          </p>
          <p className="muted" style={{ margin: 0 }}>
            {t.confirmWaiting}
          </p>
        </>
      )}
      {onCancel && (
        <button className="btn secondary" type="button" onClick={onCancel}>
          {t.cancel}
        </button>
      )}
    </div>
  );
}
