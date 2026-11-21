// P2 — link expired or already used up.

import { TG_BLUE } from "@/lib/telegram/brand";
import { env } from "@/lib/env";
import { botLink, visitorChannel } from "@/lib/telegram/channel";
import { webCopy } from "@/lib/web-copy";

export const dynamic = "force-dynamic";

export default async function LinkExpired() {
  const t = webCopy("ar");
  const en = webCopy("en");
  // Telegram visitors get a fresh start from the Telegram bot, not WhatsApp.
  const tg = (await visitorChannel()) === "telegram" ? await botLink() : null;
  const wa = env.waDisplayNumber ? `https://wa.me/${env.waDisplayNumber}?text=LINK` : null;

  return (
    <main className="page center">
      <h1 style={{ margin: 0 }}>{t.linkExpiredTitle}</h1>
      <p className="muted" style={{ margin: 0 }}>
        {t.linkExpiredBody}
      </p>
      <p className="muted" style={{ margin: 0 }} dir="ltr">
        {en.linkExpiredBody}
      </p>
      {tg ? (
        <a className="btn" href={tg} style={{ background: TG_BLUE, color: "#fff" }}>
          {t.telegramFreshLink}
        </a>
      ) : (
        wa && (
          <a className="btn" href={wa}>
            {t.getFreshLink}
          </a>
        )
      )}
    </main>
  );
}
