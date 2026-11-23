// Making every artwork size from one master picture. Pure geometry (tested); the canvas drawing is in
// ArtworkSlots. Two ways per size: "fill" cuts the master to the size around a focus point; "fit" shows the
// whole master in the middle over a blurred, enlarged copy of itself (a vertical poster as a wide banner).

export type FitMode = "fill" | "fit";
export type Rect = { x: number; y: number; w: number; h: number };

/** The part of the master (in master pixels) that "fill" keeps for an output of outW×outH, centred on the focus. */
export function fillSource(masterW: number, masterH: number, outW: number, outH: number, fx: number, fy: number): Rect {
  const scale = Math.max(outW / masterW, outH / masterH);
  const w = outW / scale;
  const h = outH / scale;
  const x = Math.min(Math.max(fx * masterW - w / 2, 0), masterW - w);
  const y = Math.min(Math.max(fy * masterH - h / 2, 0), masterH - h);
  return { x, y, w, h };
}

/** Where "fit" draws the whole master inside the output (letterboxed; the gaps get the blurred background). */
export function fitTarget(masterW: number, masterH: number, outW: number, outH: number, margin = 0): Rect {
  const scale = Math.min((outW * (1 - 2 * margin)) / masterW, (outH * (1 - 2 * margin)) / masterH);
  const w = masterW * scale;
  const h = masterH * scale;
  return { x: (outW - w) / 2, y: (outH - h) / 2, w, h };
}

/** How much of the master a "fill" crop keeps (1 = all). Below about 0.6 the whole picture usually works better. */
export function fillKeeps(masterW: number, masterH: number, outW: number, outH: number): number {
  const r = fillSource(masterW, masterH, outW, outH, 0.5, 0.5);
  return (r.w * r.h) / (masterW * masterH);
}

/** The suggested mode for a size: cut when most of the master survives, else show the whole picture. */
export const suggestedMode = (masterW: number, masterH: number, outW: number, outH: number): FitMode =>
  fillKeeps(masterW, masterH, outW, outH) >= 0.6 ? "fill" : "fit";
