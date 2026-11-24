// Account linking inside the Telegram bot:
// • "Connect Telegram" on the website opens the bot with /start link_<token>: this Telegram joins that account
//   (its own Watchat account, if it had one, is merged into it — both were proven in this one step).
// • "Share my number" in the Mini App sends the viewer's own contact (Telegram checked it): the number joins the
//   Telegram account, and an account that number already had (WhatsApp, phone sign-in) is merged into it.

import { phoneHmac } from "../bot/deps-supabase";
import { currentTenantId, db } from "../supabase";
import { siteUrl } from "../site/store";
import { tgCall } from "../telegram/client";
import { tgAddress } from "../telegram/telegram";
import { maskPhone, normalizePhone } from "./doors";
import { mergeNow, resolveViewer, useTelegramLink } from "./accounts";

async function reply(chatId: number, en: boolean, ar: string, english: string) {
  const site = (await siteUrl()).replace(/\/$/, "");
  await tgCall("sendMessage", {
    chat_id: chatId,
    text: en ? english : ar,
    reply_markup: { inline_keyboard: [[{ text: en ? "Open Watchat" : "افتح واتشات", web_app: { url: `${site}/tg?to=%2Fme` } }]] },
  });
}

const moved = (ping: number, en: boolean) => (ping > 0 ? (en ? ` ${ping} Ping moved over.` : ` نقلنا ${ping} بينج.`) : "");

export async function connectTelegram(link: { chatId: number; token: string; en: boolean }) {
  const req = await useTelegramLink(link.token);
  if (!req) return reply(link.chatId, link.en, "انتهى هذا الرابط. افتح حسابك في واتشات واضغط «ربط تيليجرام» من جديد.", "This link has expired. Open your Watchat account and tap “Connect Telegram” again.");
  const hmac = phoneHmac(tgAddress(link.chatId));
  const owner = await resolveViewer(req.tenantId, hmac);
  if (owner?.id === req.viewerId) return reply(link.chatId, link.en, "تيليجرام مربوط بحسابك من قبل ✅", "Telegram is already connected to your account ✅");
  if (owner && owner.kind !== "telegram") return reply(link.chatId, link.en, "تعذّر ربط هذا الحساب. تواصل مع الدعم.", "This account couldn't be connected. Please contact support.");
  let ping = 0;
  if (owner) ping = await mergeNow(owner.id, req.viewerId);
  else await db().from("viewer_logins").insert({ tenant_id: req.tenantId, hmac, kind: "telegram", label: null, viewer_id: req.viewerId });
  return reply(
    link.chatId,
    link.en,
    `تم ربط تيليجرام بحسابك ✅ صار حسابك واحدًا في كل مكان.${moved(ping, false)}`,
    `Telegram is connected to your account ✅ It's one account everywhere now.${moved(ping, true)}`,
  );
}

export async function shareNumber(c: { chatId: number; phone: string; en: boolean }) {
  const tenantId = await currentTenantId();
  const e164 = normalizePhone(c.phone);
  const me = await resolveViewer(tenantId, phoneHmac(tgAddress(c.chatId)));
  if (!e164 || !me) return reply(c.chatId, c.en, "افتح واتشات مرة أولًا ثم شارك رقمك.", "Open Watchat once first, then share your number.");
  const hmac = phoneHmac(e164.slice(1));
  const owner = await resolveViewer(tenantId, hmac);
  if (owner?.id === me.id) return reply(c.chatId, c.en, "رقمك مربوط بحسابك من قبل ✅", "Your number is already part of your account ✅");
  if (owner && owner.kind !== "phone") return reply(c.chatId, c.en, "تعذّر ربط هذا الرقم.", "This number couldn't be added.");
  let ping = 0;
  if (owner) ping = await mergeNow(owner.id, me.id);
  else await db().from("viewer_logins").insert({ tenant_id: tenantId, hmac, kind: "phone", label: maskPhone(e164), viewer_id: me.id });
  return reply(
    c.chatId,
    c.en,
    `أضفنا رقمك ${maskPhone(e164)} لحسابك ✅ تقدر تدخل به من أي مكان.${moved(ping, false)}`,
    `Your number ${maskPhone(e164)} is now part of your account ✅ You can sign in with it anywhere.${moved(ping, true)}`,
  );
}
