// Telegram Bot API webhook. Telegram sends each update with the secret we gave it when connecting
// (X-Telegram-Bot-Api-Secret-Token); we answer 200 at once and run the bot after the response, exactly like
// the WhatsApp webhook. Viewers are "tg:<chat id>" and go through the same handleInbound.

import { after, NextResponse, type NextRequest } from "next/server";
import { createSupabaseDeps } from "@/lib/bot/deps-supabase";
import { handleInbound } from "@/lib/bot/flow";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { siteUrl } from "@/lib/site/store";
import { db } from "@/lib/supabase";
import { tgCall } from "@/lib/telegram/client";
import { answerPreCheckout, fulfilStarsPayment, type SuccessfulPayment } from "@/lib/telegram/payments";
import { parseUpdate, webhookSecret, type PageCommand } from "@/lib/telegram/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGES: Record<PageCommand, { path: string; ar: string; en: string; button: { ar: string; en: string } }> = {
  store: { path: "/store", ar: "باقات بينج وباقات المشاهدة 👇", en: "Ping packs and passes 👇", button: { ar: "افتح المتجر", en: "Open the store" } },
  rewards: { path: "/rewards", ar: "خذ بينج مجاني كل يوم وادعُ أصحابك 🎁", en: "Free Ping every day, and for inviting friends 🎁", button: { ar: "مكافآت بينج", en: "Ping rewards" } },
};

export async function POST(req: NextRequest) {
  const token = env.telegramBotToken;
  if (!token) return new NextResponse("Not configured", { status: 404 });
  if (!safeEqual(req.headers.get("x-telegram-bot-api-secret-token") ?? "", webhookSecret(token))) {
    return new NextResponse("Forbidden", { status: 401 });
  }
  let update: unknown;
  try {
    update = await req.json();
  } catch {
    return new NextResponse("Bad JSON", { status: 400 });
  }
  const parsed = parseUpdate(update);
  if (!parsed) return NextResponse.json({ ok: true });

  // Telegram waits up to 10 seconds for the payment confirmation: answer it before anything else.
  if (parsed.preCheckout) {
    await answerPreCheckout(parsed.preCheckout);
    return NextResponse.json({ ok: true });
  }

  after(async () => {
    if (parsed.payment) {
      const p = parsed.payment.data as unknown as SuccessfulPayment;
      try {
        const r = await fulfilStarsPayment(parsed.payment.chatId, p);
        if (r === "ok") {
          const en = (update as { message?: { from?: { language_code?: string } } }).message?.from?.language_code?.startsWith("en");
          const site = (await siteUrl()).replace(/\/$/, "");
          await tgCall("sendMessage", {
            chat_id: parsed.payment.chatId,
            text: en ? "Payment received ✅ Your purchase is in your wallet. Enjoy watching! 🍿" : "تم الدفع ✅ أضفنا مشترياتك لمحفظتك. مشاهدة ممتعة 🍿",
            reply_markup: { inline_keyboard: [[{ text: en ? "Open Watchat" : "افتح واتشات", web_app: { url: `${site}/tg?to=%2Fwallet` } }]] },
          });
        }
      } catch (err) {
        console.error("[telegram] payment failed to fulfil", { err });
      }
      return;
    }
    // Stop the button's spinner right away.
    if (parsed.callbackQueryId) await tgCall("answerCallbackQuery", { callback_query_id: parsed.callbackQueryId });
    // De-duplicate: Telegram retries updates it thinks failed.
    const { error: dup } = await db().from("wa_inbound").insert({ wa_message_id: `tg:${parsed.updateId}` });
    if (dup) return;

    const chatId = (update as { message?: { chat?: { id?: number } } }).message?.chat?.id;
    if (parsed.page && chatId) {
      // /store and /rewards: a button that opens the page inside Telegram (the Mini App signs the viewer in).
      const site = (await siteUrl()).replace(/\/$/, "");
      const en = (update as { message?: { from?: { language_code?: string } } }).message?.from?.language_code?.startsWith("en");
      const page = PAGES[parsed.page];
      await tgCall("sendMessage", {
        chat_id: chatId,
        text: en ? page.en : page.ar,
        reply_markup: { inline_keyboard: [[{ text: en ? page.button.en : page.button.ar, web_app: { url: `${site}/tg?to=${encodeURIComponent(page.path)}` } }]] },
      });
      return;
    }
    if (!parsed.msg) return;
    try {
      await handleInbound(parsed.msg, createSupabaseDeps());
    } catch (err) {
      console.error("[telegram] handleInbound failed", { id: parsed.msg.id, err });
    }
  });

  return NextResponse.json({ ok: true });
}
