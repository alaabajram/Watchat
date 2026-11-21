"use client";

// Which chat app this canvas runs for. A series (or the shared replies) has one flow for WhatsApp + Telegram, or a
// WhatsApp + Telegram pair: "Make a separate Telegram flow" copies it, "Use one flow for both" merges it back.
// Sequences pick Both / WhatsApp only / Telegram only.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { mergeFlow, splitFlow } from "@/app/admin/flow-actions";
import { setSequenceChannel } from "@/app/admin/sequence-actions";
import { mergeShared, splitShared } from "@/app/admin/shared-flow-actions";
import { CHANNEL_COLOR, CHANNEL_LABEL, type FlowChannel } from "@/lib/flows/types";

export function ChannelDot({ channel, size = 9 }: { channel: FlowChannel; size?: number }) {
  const dots = channel === "both" ? (["whatsapp", "telegram"] as const) : ([channel] as const);
  return (
    <span aria-hidden="true" style={{ display: "inline-flex", gap: 2 }}>
      {dots.map((c) => (
        <span key={c} style={{ width: size, height: size, borderRadius: "50%", background: CHANNEL_COLOR[c], display: "inline-block" }} />
      ))}
    </span>
  );
}

export function ChannelBadge({ channel }: { channel: FlowChannel }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, padding: "3px 10px", borderRadius: 999, background: "#f4f2ee" }}>
      <ChannelDot channel={channel} />
      {CHANNEL_LABEL[channel]}
    </span>
  );
}

const tab = (on: boolean, c: "whatsapp" | "telegram") => ({
  padding: "5px 12px",
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 600,
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  background: on ? CHANNEL_COLOR[c] : "transparent",
  color: on ? "#fff" : "var(--a-text)",
});

export function ChannelBar(p: { mode: "series" | "shared"; seriesId: string; channel: FlowChannel; split: boolean; dirty: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const base = p.mode === "shared" ? "/admin/bot" : `/admin/flows/${p.seriesId}`;
  const what = p.mode === "shared" ? "shared replies" : "flow";

  async function split() {
    if (p.dirty && !confirm("Save or publish your changes first — the copy is made from the saved draft. Continue anyway?")) return;
    if (!confirm(`Make a separate Telegram ${what}? Both start as copies of this one; from then on you edit them separately.`)) return;
    setBusy(true);
    const r = p.mode === "shared" ? await splitShared() : await splitFlow(p.seriesId);
    setBusy(false);
    if (!r.ok) return alert(r.error ?? "Couldn't split.");
    router.push(`${base}?channel=telegram`);
    router.refresh();
  }
  async function merge() {
    if (!confirm(`Use one ${what} for both apps again? The Telegram ${what} is deleted and the WhatsApp one runs for Telegram viewers too.`)) return;
    setBusy(true);
    if (p.mode === "shared") await mergeShared();
    else await mergeFlow(p.seriesId);
    setBusy(false);
    router.push(base);
    router.refresh();
  }

  if (!p.split) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <ChannelBadge channel="both" />
        <button type="button" className="secondary" onClick={split} disabled={busy} style={{ fontSize: 12 }} title={`Telegram gets its own ${what}, starting as a copy`}>
          Separate Telegram {what}
        </button>
      </span>
    );
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <nav aria-label="Chat app" style={{ display: "inline-flex", gap: 2, padding: 3, borderRadius: 999, background: "#f4f2ee" }}>
        <a href={base} aria-current={p.channel !== "telegram" ? "page" : undefined} style={tab(p.channel !== "telegram", "whatsapp")}>
          WhatsApp
        </a>
        <a href={`${base}?channel=telegram`} aria-current={p.channel === "telegram" ? "page" : undefined} style={tab(p.channel === "telegram", "telegram")}>
          Telegram
        </a>
      </nav>
      <button type="button" className="secondary" onClick={merge} disabled={busy} style={{ fontSize: 12 }}>
        One {what} for both
      </button>
    </span>
  );
}

export function SequenceChannelSelect({ id, channel }: { id: string; channel: FlowChannel }) {
  const router = useRouter();
  const [value, setValue] = useState(channel);
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
      <ChannelDot channel={value} />
      <select
        value={value}
        aria-label="Runs for"
        onChange={async (e) => {
          const next = e.target.value as FlowChannel;
          setValue(next);
          await setSequenceChannel(id, next);
          router.refresh();
        }}
        style={{ fontSize: 13 }}
      >
        <option value="both">WhatsApp + Telegram</option>
        <option value="whatsapp">WhatsApp only</option>
        <option value="telegram">Telegram only (free messages)</option>
      </select>
    </label>
  );
}
