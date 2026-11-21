"use client";
// Save / remove a series in My List (round bookmark button on the hero card and the series page).

import { useState } from "react";
import { BookmarkIcon } from "@/components/brand/icons";

export function BookmarkButton({ code, saved, labels }: { code: string; saved: boolean; labels: { add: string; remove: string } }) {
  const [on, setOn] = useState(saved);
  const [busy, setBusy] = useState(false);
  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    setOn(!on); // feels instant; put back if the server says otherwise
    try {
      const r = await fetch("/api/list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      const j = (await r.json().catch(() => ({}))) as { saved?: boolean };
      setOn(typeof j.saved === "boolean" ? j.saved : on);
    } catch {
      setOn(on);
    } finally {
      setBusy(false);
    }
  }
  return (
    <button type="button" className="wc-iconbtn" onClick={toggle} aria-pressed={on} aria-label={on ? labels.remove : labels.add}>
      <BookmarkIcon fill={on ? "var(--wc-mint)" : "none"} color={on ? "var(--wc-mint)" : "currentColor"} />
    </button>
  );
}
