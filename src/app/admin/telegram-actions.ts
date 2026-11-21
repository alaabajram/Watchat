"use server";

// Admin → Brand & site → Telegram: point the bot at this site (webhook, "شاهد" menu button, commands).

import { audit, requireAdmin } from "@/lib/admin/auth";
import { done } from "@/lib/admin/forms";
import { connectTelegram, telegramConfigured } from "@/lib/telegram/client";

export async function connectTelegramAction() {
  const admin = await requireAdmin("site");
  if (!telegramConfigured()) done("/admin/site", "Add TELEGRAM_BOT_TOKEN in Vercel → Settings → Environment Variables, redeploy, then connect.", "err");
  const r = await connectTelegram();
  await audit(admin, "telegram.connected", "telegram", null, { ok: r.ok, errors: r.errors });
  done("/admin/site", r.ok ? "Telegram connected: the bot answers here, and its menu button opens Watchat." : `Telegram: ${r.errors.join(" · ")}`, r.ok ? "ok" : "err");
}
