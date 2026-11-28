"use client";

// "Share as picture": draws a 1080×1350 card in the browser (the phone shapes Arabic correctly in a canvas) and
// hands it to the share sheet, or downloads it where the share sheet can't take files.

import { useState } from "react";
import { trackShare } from "./ShareLink";

export type ShareCard = {
  kicker: string;
  title: string;
  body?: string;
  emoji?: string;
  accent: string;
  /** Result bars (room results, the daily question). */
  bars?: { label: string; pct: number; mine?: boolean }[];
  footer: string;
};

const W = 1080;
const H = 1350;

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = w;
      if (lines.length === maxLines) break;
    } else line = next;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) lines[maxLines - 1] = `${lines[maxLines - 1].replace(/\s+\S*$/, "")} …`;
  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export async function drawShareCard(card: ShareCard, rtl: boolean): Promise<Blob | null> {
  try {
    await document.fonts?.ready;
  } catch {
    /* fonts API missing */
  }
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const font = getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";
  ctx.direction = rtl ? "rtl" : "ltr";
  ctx.textAlign = rtl ? "right" : "left";
  const x = rtl ? W - 90 : 90;
  const width = W - 180;

  // Background: night with the accent glow.
  ctx.fillStyle = "#0f0d14";
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W * (rtl ? 0.15 : 0.85), 120, 40, W * (rtl ? 0.15 : 0.85), 120, 900);
  g.addColorStop(0, `${card.accent}66`);
  g.addColorStop(1, "#0f0d1400");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  let y = 150;
  if (card.emoji) {
    ctx.font = `120px ${font}`;
    ctx.fillText(card.emoji, x, y + 40);
    y += 150;
  }
  ctx.fillStyle = card.accent;
  ctx.font = `600 40px ${font}`;
  ctx.fillText(card.kicker, x, y);
  y += 90;

  ctx.fillStyle = "#f5f2f8";
  ctx.font = `700 68px ${font}`;
  for (const l of wrap(ctx, card.title, width, 4)) {
    ctx.fillText(l, x, y);
    y += 88;
  }
  y += 10;

  if (card.bars?.length) {
    ctx.font = `500 40px ${font}`;
    for (const b of card.bars.slice(0, 5)) {
      roundRect(ctx, 90, y, width, 96, 28);
      ctx.fillStyle = "#262130";
      ctx.fill();
      ctx.save();
      roundRect(ctx, 90, y, width, 96, 28);
      ctx.clip();
      ctx.fillStyle = `${card.accent}${b.mine ? "aa" : "55"}`;
      const bw = (width * Math.max(b.pct, 0)) / 100;
      ctx.fillRect(rtl ? 90 + width - bw : 90, y, bw, 96);
      ctx.restore();
      ctx.fillStyle = "#f5f2f8";
      ctx.textAlign = rtl ? "right" : "left";
      ctx.fillText(`${b.mine ? "✓ " : ""}${b.label}`.slice(0, 40), rtl ? 90 + width - 30 : 120, y + 62);
      ctx.textAlign = rtl ? "left" : "right";
      ctx.font = `700 40px ${font}`;
      ctx.fillText(`${b.pct}%`, rtl ? 120 : 90 + width - 30, y + 62);
      ctx.font = `500 40px ${font}`;
      ctx.textAlign = rtl ? "right" : "left";
      y += 120;
    }
  } else if (card.body) {
    ctx.fillStyle = "#d9d3e2";
    ctx.font = `400 46px ${font}`;
    for (const l of wrap(ctx, card.body, width, 9)) {
      ctx.fillText(l, x, y);
      y += 70;
    }
  }

  // Footer: brand line.
  ctx.fillStyle = "#a39cae";
  ctx.font = `500 34px ${font}`;
  ctx.textAlign = rtl ? "right" : "left";
  ctx.fillText(card.footer, x, H - 110);
  ctx.fillStyle = card.accent;
  ctx.fillRect(rtl ? W - 90 - 120 : 90, H - 80, 120, 8);

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}

export function ShareImageButton({ card, locale, file, event }: { card: ShareCard; locale: "ar" | "en"; file: string; event?: string }) {
  const [busy, setBusy] = useState(false);
  const label = locale === "ar" ? "شارك كصورة" : "Share as picture";
  const go = async () => {
    setBusy(true);
    try {
      const blob = await drawShareCard(card, locale === "ar");
      if (!blob) return;
      const f = new File([blob], `${file}.png`, { type: "image/png" });
      if (navigator.canShare?.({ files: [f] })) {
        await navigator.share({ files: [f], text: `${card.title}\n${window.location.origin}` });
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = f.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      }
      if (event) trackShare(event);
    } catch {
      /* cancelled */
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className="pl-btn pl-btn-soft" onClick={go} disabled={busy}>
      🖼️ {busy ? "…" : label}
    </button>
  );
}
