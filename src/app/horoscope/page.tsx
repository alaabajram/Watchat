// Daily Horoscope: your sign first, then all twelve for today (shareable). Entertainment and reflection.

import Link from "next/link";
import { PlayShell, SignedOut } from "@/components/play/PlayShell";
import { playDay, SIGNS, signDates } from "@/lib/daily/daily";
import { playCopy } from "@/lib/play/copy";
import { horoscopeFor, todayFor } from "@/lib/play/store";
import { getSessionViewer } from "@/lib/session";
import { currentTenantId } from "@/lib/supabase";
import { trackEvent } from "@/lib/events";
import { getBalance } from "@/lib/wallet";

export const dynamic = "force-dynamic";

export default async function HoroscopePage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const viewer = await getSessionViewer();
  if (!viewer) return <SignedOut path="/horoscope" lang={(await searchParams).lang} />;
  const tenantId = await currentTenantId();
  const locale = viewer.uiLocale;
  const ar = locale === "ar";
  const t = playCopy(locale);
  const day = playDay();
  const [balance, today, all] = await Promise.all([
    getBalance(viewer.id),
    todayFor(tenantId, viewer.id),
    Promise.all(SIGNS.map(async (s) => ({ s, h: await horoscopeFor(tenantId, s.key, day) }))),
    trackEvent({ viewerHmac: viewer.phoneHmac, name: "horoscope_view" }),
  ]);
  const ordered = today.sign ? [...all.filter((x) => x.s.key === today.sign), ...all.filter((x) => x.s.key !== today.sign)] : all;
  return (
    <PlayShell locale={locale} balance={balance} nav="today" backHref="/today">
      <header className="pl-hero">
        <h1 className="pl-h1">✨ {t.horoscope}</h1>
        <p className="pl-sub">{t.disclaimer}</p>
        {!today.sign ? <Link className="wc-link" href="/today">{t.pickSign} →</Link> : null}
      </header>
      <div className="pl-section">
        {ordered.map(({ s, h }) => (
          <section key={s.key} className="pl-card" style={{ ["--pl-accent" as string]: s.key === today.sign ? "#ff5a48" : "#7c5cff" }}>
            <div className="pl-row">
              <h2 className="pl-title">
                <span aria-hidden="true">{s.symbol}</span> {ar ? s.ar : s.en}
              </h2>
              <span className="pl-muted">{signDates(s.key, locale)}</span>
            </div>
            <p style={{ marginTop: 8 }}>{ar ? h.ar : h.en}</p>
            <div className="pl-facts" style={{ marginTop: 10 }}>
              <span className="pl-tag">{t.lucky}: {h.luckyNumber}</span>
              {(ar ? h.moodAr : h.moodEn) ? <span className="pl-tag">{t.mood}: {ar ? h.moodAr : h.moodEn}</span> : null}
            </div>
          </section>
        ))}
      </div>
    </PlayShell>
  );
}
