// The Telegram Mini App's entry (the bot's "شاهد" menu button and /store, /rewards buttons open it).
// It signs the viewer in with Telegram's signed launch data, then opens the asked page.

import { TelegramEntry } from "@/components/TelegramEntry";

export const dynamic = "force-dynamic";

export default async function TelegramPage({ searchParams }: { searchParams: Promise<{ to?: string }> }) {
  const { to } = await searchParams;
  return <TelegramEntry to={to && to.startsWith("/") && !to.startsWith("//") ? to : null} />;
}
