// Share a series with a friend: opens WhatsApp's share sheet with the Watchat chat link for that series
// (wa.me/<number>?text=<series code>). The friend starts in WhatsApp, so the bot creates THEIR account
// from their own number — a personal link is never what gets shared.

import { ShareIcon } from "@/components/brand/icons";
import { env } from "@/lib/env";
import { webCopy, type Locale } from "@/lib/web-copy";

export function shareHref(code: string, title: string, locale: Locale): string | null {
  if (!env.waDisplayNumber) return null;
  const entry = `https://wa.me/${env.waDisplayNumber}?text=${encodeURIComponent(code)}`;
  return `https://wa.me/?text=${encodeURIComponent(webCopy(locale).shareText(title, entry))}`;
}

export function ShareButton({ code, title, locale, dark = false }: { code: string; title: string; locale: Locale; dark?: boolean }) {
  const href = shareHref(code, title, locale);
  if (!href) return null;
  return (
    <a className="btn secondary" href={href} target="_blank" rel="noopener noreferrer" style={dark ? undefined : { minHeight: 50 }}>
      <ShareIcon />
      {webCopy(locale).share}
    </a>
  );
}
