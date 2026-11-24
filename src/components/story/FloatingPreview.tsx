"use client";

// The Story builder's phone preview as a floating window: drag it by its bar to any place on the screen, fold it
// down to the bar, and it remembers where it was (per browser). It stays inside the window when the window
// is resized.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

const KEY = "story-preview-pos";
type Pos = { x: number; y: number; folded: boolean };

const clamp = (p: Pos, el: HTMLElement | null): Pos => {
  const w = el?.offsetWidth ?? 320;
  const h = el?.offsetHeight ?? 120;
  return {
    ...p,
    x: Math.min(Math.max(8, p.x), Math.max(8, window.innerWidth - w - 8)),
    y: Math.min(Math.max(8, p.y), Math.max(8, window.innerHeight - Math.min(h, 60) - 8)),
  };
};

export function FloatingPreview(p: { title: string; tools: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const [pos, setPos] = useState<Pos | null>(null);

  // Start where it was left, else at the bottom-right corner.
  useEffect(() => {
    let saved: Pos | null = null;
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) saved = JSON.parse(raw) as Pos;
    } catch {
      /* not remembered */
    }
    const w = box.current?.offsetWidth ?? 320;
    const h = box.current?.offsetHeight ?? 600;
    setPos(clamp(saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? saved : { x: window.innerWidth - w - 24, y: window.innerHeight - h - 24, folded: false }, box.current));
    const onResize = () => setPos((q) => (q ? clamp(q, box.current) : q));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const save = useCallback((q: Pos) => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(q));
    } catch {
      /* not remembered */
    }
  }, []);

  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button") || !pos) return;
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const d = drag.current;
    setPos((q) => (q ? clamp({ ...q, x: e.clientX - d.dx, y: e.clientY - d.dy }, box.current) : q));
  };
  const onUp = () => {
    if (!drag.current) return;
    drag.current = null;
    setPos((q) => {
      if (q) save(q);
      return q;
    });
  };
  const fold = () =>
    setPos((q) => {
      if (!q) return q;
      const next = clamp({ ...q, folded: !q.folded }, box.current);
      save(next);
      return next;
    });
  const reset = () => {
    const w = box.current?.offsetWidth ?? 320;
    const h = box.current?.offsetHeight ?? 600;
    const next = clamp({ x: window.innerWidth - w - 24, y: window.innerHeight - h - 24, folded: false }, box.current);
    setPos(next);
    save(next);
  };

  return (
    <div
      ref={box}
      className={`story-float${pos?.folded ? " folded" : ""}`}
      style={pos ? { left: pos.x, top: pos.y } : { right: 24, bottom: 24, visibility: "hidden" }}
      role="dialog"
      aria-label={p.title}
    >
      <div className="story-float-bar" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onDoubleClick={reset} title="Drag to move · double-click to put it back in the corner">
        <span aria-hidden="true" className="story-float-grip">
          ⠿
        </span>
        <strong>{p.title}</strong>
        <span style={{ flex: 1 }} />
        <button type="button" className="secondary small" onClick={fold} aria-expanded={!pos?.folded} title={pos?.folded ? "Show the preview" : "Fold to the bar"}>
          {pos?.folded ? "▢" : "–"}
        </button>
      </div>
      {!pos?.folded && (
        <div className="story-float-body">
          <div className="row" style={{ gap: 6, justifyContent: "center" }}>
            {p.tools}
          </div>
          {p.children}
          {p.footer}
        </div>
      )}
    </div>
  );
}
