// Which chat app the visitor uses (server): Telegram when they came from the Telegram Mini App (marker cookie
// set at sign-in) or the page is open inside Telegram's in-app browser; WhatsApp otherwise. Signed-out
// screens use it to offer the right way in.

import { cookies, headers } from "next/headers";
import { env } from "../env";
import { telegramConfigured, tgCall } from "./client";

export const CHANNEL_COOKIE = "wc_ch";

export async function visitorChannel(): Promise<"telegram" | "whatsapp"> {
  if (!telegramConfigured()) return "whatsapp";
  const [c, h] = await Promise.all([cookies(), headers()]);
  if (c.get(CHANNEL_COOKIE)?.value === "tg") return "telegram";
  return /Telegram/i.test(h.get("user-agent") ?? "") ? "telegram" : "whatsapp";
}

let cachedUsername: string | null = null;

/** The bot's @username (from Telegram, cached), for t.me links. */
export async function botUsername(): Promise<string | null> {
  if (cachedUsername) return cachedUsername;
  if (process.env.TELEGRAM_BOT_USERNAME) return (cachedUsername = process.env.TELEGRAM_BOT_USERNAME.replace(/^@/, ""));
  if (!env.telegramBotToken) return null;
  const me = await tgCall<{ username?: string }>("getMe");
  cachedUsername = me.result?.username ?? null;
  return cachedUsername;
}

/** t.me link to the bot, optionally starting at a series, invite or partner code. */
export async function botLink(start?: string | null): Promise<string | null> {
  const u = await botUsername();
  if (!u) return null;
  return start && /^[A-Za-z0-9_-]{1,64}$/.test(start) ? `https://t.me/${u}?start=${start}` : `https://t.me/${u}`;
}
