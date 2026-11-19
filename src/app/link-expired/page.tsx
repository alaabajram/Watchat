// P2 — link expired or already used up.

import { env } from "@/lib/env";
import { webCopy } from "@/lib/web-copy";

export const dynamic = "force-dynamic";

export default function LinkExpired() {
  const t = webCopy("ar");
  const en = webCopy("en");
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
      {wa && (
        <a className="btn" href={wa}>
          {t.getFreshLink}
        </a>
      )}
    </main>
  );
}
