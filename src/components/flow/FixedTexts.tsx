"use client";

// Texts the bot still sends by itself in Shared replies (not on any card): an unknown code, the other-series
// list, the growth agent's picks, the one-time pin tip… Same save rules as before: default text = no override.

import { useMemo, useState, useTransition } from "react";
import { saveFixedTexts } from "@/app/admin/shared-flow-actions";
import { COPY, type CopyKey } from "@/lib/bot/copy";

const WHEN: Partial<Record<CopyKey, string>> = {
  needSeriesFirst: "Before the “anything else” reply, to viewers with no series yet",
  seriesNotFound: "A series code that doesn't exist",
  notForMeBody: "“Not for me” under a trailer or episode: the list of other series",
  btnSeeSeries: "That list's button",
  seriesSectionTitle: "That list's heading",
  noOtherSeries: "“Not for me” when no other series is live",
  picksBody: "Above the growth agent's picks (“See my picks”)",
  pinHint: "Added once, under a viewer's very first personal link",
};

export function FixedTexts({ keys, saved }: { keys: CopyKey[]; saved: Record<string, string> }) {
  const initial = useMemo(() => {
    const v: Record<string, string> = {};
    for (const k of keys) for (const l of ["ar", "en"] as const) v[`${k}.${l}`] = saved[`${k}.${l}`] ?? COPY[k][l];
    return v;
  }, [keys, saved]);
  const [base, setBase] = useState(initial);
  const [values, setValues] = useState(initial);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  const dirty = Object.keys(values).some((k) => values[k] !== base[k]);

  return (
    <details style={{ background: "#fff", borderRadius: 22, boxShadow: "var(--a-shadow)", padding: "14px 18px", marginTop: 16 }}>
      <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 16 }}>Texts the bot sends by itself</summary>
      <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
        These go out automatically (not from a card above), for every series. Placeholders: <code>{"{title}"}</code> series name.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))", gap: 14 }}>
        {keys.map((k) => {
          const short = COPY[k].kind === "button";
          const max = short ? 20 : 1000;
          return (
            <div key={k} style={{ background: "#f7f5f2", borderRadius: 16, padding: 12 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <strong style={{ fontSize: 13, flex: 1 }}>{COPY[k].label.replace(/^W\d+(\/W\d+)? · /, "")}</strong>
                {(["ar", "en"] as const).some((l) => values[`${k}.${l}`].trim() !== COPY[k][l]) && (
                  <button
                    type="button"
                    onClick={() => setValues((v) => ({ ...v, [`${k}.ar`]: COPY[k].ar, [`${k}.en`]: COPY[k].en }))}
                    style={{ background: "none", color: "#027eb5", padding: 0, fontSize: 12, boxShadow: "none" }}
                  >
                    Reset to default
                  </button>
                )}
              </div>
              <div className="muted" style={{ fontSize: 12, margin: "2px 0 8px" }}>{WHEN[k]}</div>
              {(["ar", "en"] as const).map((l) => {
                const v = values[`${k}.${l}`];
                const common = {
                  value: v,
                  dir: l === "ar" ? "rtl" : "ltr",
                  "aria-label": `${COPY[k].label} · ${l === "ar" ? "Arabic" : "English"}`,
                  onChange: (e: { target: { value: string } }) => setValues((x) => ({ ...x, [`${k}.${l}`]: e.target.value })),
                  style: { width: "100%", boxSizing: "border-box" as const, marginBottom: 6, borderColor: Array.from(v).length > max ? "#e0453a" : undefined },
                };
                return short ? <input key={l} {...common} maxLength={40} /> : <textarea key={l} {...common} rows={2} />;
              })}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
        <button
          type="button"
          disabled={!dirty || pending}
          onClick={() =>
            start(async () => {
              const r = await saveFixedTexts(values);
              setStatus(r);
              if (r.ok) setBase(values);
            })
          }
        >
          {pending ? "Saving…" : "Save texts"}
        </button>
        <span role="status" className="muted" style={{ fontSize: 12, color: status && !status.ok ? "#b42318" : undefined }}>
          {dirty ? "Unsaved changes" : (status?.message ?? "")}
        </span>
      </div>
    </details>
  );
}
