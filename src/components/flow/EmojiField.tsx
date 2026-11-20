"use client";

// An input or textarea with an emoji button. Picking an emoji inserts it at the cursor (or replaces
// the selection), keeps focus in the field, and remembers recent picks on this device.

import { useEffect, useRef, useState } from "react";
import { EMOJI_GROUPS, insertText, searchEmoji } from "@/lib/emoji";

const RECENT_KEY = "wc_recent_emoji";
const loadRecent = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 16) : [];
  } catch {
    return [];
  }
};
const saveRecent = (list: string[]) => {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 16)));
  } catch {
    /* storage unavailable: recents just aren't kept */
  }
};

type Props = {
  value: string;
  onChange: (v: string) => void;
  dir?: "rtl" | "ltr";
  rows?: number; // > 1 = textarea
  placeholder?: string;
  maxLength?: number;
  invalid?: boolean;
  compact?: boolean;
};

export function EmojiField({ value, onChange, dir, rows = 1, placeholder, maxLength, invalid, compact }: Props) {
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const selection = useRef<{ start: number | null; end: number | null }>({ start: null, end: null });
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState(EMOJI_GROUPS[0].id);
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setRecent(loadRecent());
    const close = (e: MouseEvent) => wrap.current && !wrap.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const remember = () => {
    const el = field.current;
    if (el) selection.current = { start: el.selectionStart, end: el.selectionEnd };
  };

  const pick = (emoji: string) => {
    const { start, end } = selection.current;
    const r = insertText(value, start, end, emoji);
    if (maxLength && r.value.length > maxLength) return;
    onChange(r.value);
    selection.current = { start: r.caret, end: r.caret };
    const next = [emoji, ...recent.filter((e) => e !== emoji)];
    setRecent(next);
    saveRecent(next);
    requestAnimationFrame(() => {
      field.current?.focus();
      field.current?.setSelectionRange(r.caret, r.caret);
    });
  };

  const common = {
    ref: field,
    dir,
    value,
    placeholder,
    maxLength,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
    onSelect: remember,
    onKeyUp: remember,
    onClick: remember,
    onBlur: remember,
    style: { width: "100%", fontSize: 13, paddingInlineEnd: 28, borderColor: invalid ? "#dc2626" : undefined },
  };
  const results = query ? searchEmoji(query) : (EMOJI_GROUPS.find((g) => g.id === group)?.items.map((i) => i[0]) ?? []);

  return (
    <div ref={wrap} style={{ position: "relative", width: "100%" }}>
      {rows > 1 ? <textarea rows={rows} {...common} /> : <input {...common} />}
      <button
        type="button"
        title="Add emoji"
        aria-label="Add emoji"
        onMouseDown={(e) => e.preventDefault()} // keep the cursor where it was
        onClick={() => setOpen((o) => !o)}
        style={{ position: "absolute", top: compact ? 2 : 4, insetInlineEnd: 4, background: "transparent", border: 0, padding: 2, fontSize: 15, lineHeight: 1, cursor: "pointer", opacity: open ? 1 : 0.65 }}
      >
        😊
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Emoji picker"
          style={{ position: "absolute", top: "100%", insetInlineEnd: 0, zIndex: 30, width: 290, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, boxShadow: "0 8px 24px #0002", padding: 8, marginTop: 4 }}
          dir="ltr"
        >
          <input autoFocus placeholder="Search: heart, fire, رمضان…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: "100%", fontSize: 12, marginBottom: 6 }} />
          {!query && (
            <div style={{ display: "flex", gap: 2, marginBottom: 6 }}>
              {EMOJI_GROUPS.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  title={g.label}
                  onClick={() => setGroup(g.id)}
                  style={{ flex: 1, background: group === g.id ? "#e0e7ff" : "transparent", border: 0, borderRadius: 6, padding: 4, fontSize: 16, cursor: "pointer" }}
                >
                  {g.icon}
                </button>
              ))}
            </div>
          )}
          {!query && recent.length > 0 && (
            <>
              <div style={{ fontSize: 11, color: "#6b7280" }}>Recent</div>
              <Grid items={recent} onPick={pick} />
            </>
          )}
          {!query && <div style={{ fontSize: 11, color: "#6b7280" }}>{EMOJI_GROUPS.find((g) => g.id === group)?.label}</div>}
          {results.length ? <Grid items={results} onPick={pick} /> : <div style={{ fontSize: 12, color: "#6b7280", padding: 8 }}>No emoji found.</div>}
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>Emoji count toward WhatsApp&apos;s character limits.</div>
        </div>
      )}
    </div>
  );
}

function Grid({ items, onPick }: { items: string[]; onPick: (e: string) => void }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 2, maxHeight: 170, overflowY: "auto", marginBottom: 4 }}>
      {items.map((e) => (
        <button
          key={e}
          type="button"
          onMouseDown={(ev) => ev.preventDefault()}
          onClick={() => onPick(e)}
          style={{ background: "transparent", border: 0, borderRadius: 6, padding: 3, fontSize: 20, lineHeight: 1.2, cursor: "pointer" }}
          onMouseEnter={(ev) => (ev.currentTarget.style.background = "#f1f5f9")}
          onMouseLeave={(ev) => (ev.currentTarget.style.background = "transparent")}
        >
          {e}
        </button>
      ))}
    </div>
  );
}
