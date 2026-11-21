// The Telegram Mini App's entry (the bot's «شاهد» menu button, /store, /rewards and personal links from Telegram).
// It signs the viewer in with Telegram's signed launch data, then opens the asked page.

import { TelegramEntry } from "@/components/TelegramEntry";
import { botLink } from "@/lib/telegram/channel";

export const dynamic = "force-dynamic";

export default async function TelegramPage({ searchParams }: { searchParams: Promise<{ to?: string; lang?: string }> }) {
  const { to, lang } = await searchParams;
  return <TelegramEntry to={to && to.startsWith("/") && !to.startsWith("//") ? to : null} botHref={await botLink()} locale={lang === "en" ? "en" : "ar"} />;
}
