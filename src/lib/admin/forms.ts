// Small helpers for admin server actions: read FormData safely and redirect with a message.

import { redirect } from "next/navigation";

export const str = (fd: FormData, key: string, max = 4000): string => String(fd.get(key) ?? "").trim().slice(0, max);
export const opt = (fd: FormData, key: string, max = 4000): string | null => str(fd, key, max) || null;
export const int = (fd: FormData, key: string, fallback = 0): number => {
  const n = Number.parseInt(String(fd.get(key) ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
};
export const num = (fd: FormData, key: string): number | null => {
  const raw = String(fd.get(key) ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};
export const bool = (fd: FormData, key: string): boolean => fd.get(key) === "on" || fd.get(key) === "true";
export const uuid = (fd: FormData, key: string): string | null => {
  const v = str(fd, key, 64);
  return /^[0-9a-f-]{36}$/.test(v) ? v : null;
};

/** Redirect back to a page with a one-line message (?ok= or ?err=). */
export function done(path: string, message: string, kind: "ok" | "err" = "ok"): never {
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}${kind}=${encodeURIComponent(message)}`);
}
