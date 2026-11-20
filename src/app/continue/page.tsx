// Shown when a personal link can't sign this person in (already opened, too old, or this phone belongs
// to another account). They continue in WhatsApp and the bot sends a link for THEIR OWN number.

import { env } from "@/lib/env";
import { dirFor, webCopy } from "@/lib/web-copy";

export const dynamic = "force-dynamic";

export default async function ContinuePage({ searchParams }: { searchParams: Promise<{ s?: string; e?: string }> }) {
  const sp = await searchParams;
  const code = /^[A-Z]{3,}\d{1,3}$/.test(sp.s ?? "") ? sp.s! : null;
  const ep = /^\d{1,3}$/.test(sp.e ?? "") ? sp.e! : null;
  const message = code ? `WATCH ${code}${ep ? ` ${ep}` : ""}` : "LINK";
  const wa = env.waDisplayNumber ? `https://wa.me/${env.waDisplayNumber}?text=${encodeURIComponent(message)}` : null;
  const ar = webCopy("ar");
  const en = webCopy("en");

  return (
    <main className="page center">
      <section dir={dirFor("ar")} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h1 style={{ margin: 0 }}>{ar.continueTitle}</h1>
        <p style={{ margin: 0 }}>{ar.continueBody}</p>
        {wa && (
          <a className="btn" href={wa}>
            {ar.continueButton}
          </a>
        )}
        <p className="muted" style={{ margin: 0 }}>
          {ar.continueManual(message)}
        </p>
      </section>
      <section dir={dirFor("en")} className="muted" style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
        <strong>{en.continueTitle}</strong>
        <span>{en.continueBody}</span>
        <span>{en.continueManual(message)}</span>
      </section>
    </main>
  );
}
