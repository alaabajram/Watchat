// "My account" — the one fixed link viewers keep (WhatsApp business profile, pinned message).
// Same address for everyone: the browser's own session decides whose account opens, so a forwarded
// link never opens someone else's. Not signed in → one tap opens WhatsApp to get a sign-in link.
// Coming back here costs no WhatsApp messages.

import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import { getLibrary } from "@/lib/content";
import { env } from "@/lib/env";
import { ACCOUNT_WORD } from "@/lib/links";
import { getSessionViewer } from "@/lib/session";
import { getBalance } from "@/lib/wallet";
import { dirFor, webCopy } from "@/lib/web-copy";

export const dynamic = "force-dynamic";
export const metadata = { title: "Watchat · حسابي" };

function Poster({ url, alt }: { url: string | null; alt: string }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={alt} style={{ width: "100%", aspectRatio: "2 / 3", objectFit: "cover", borderRadius: 10, display: "block" }} />
  ) : (
    <div style={{ width: "100%", aspectRatio: "2 / 3", borderRadius: 10, background: "#222", display: "grid", placeItems: "center", padding: 8, textAlign: "center" }}>{alt}</div>
  );
}

export default async function MyAccountPage() {
  const viewer = await getSessionViewer();
  if (!viewer) {
    const t = webCopy("ar");
    const en = webCopy("en");
    const wa = env.waDisplayNumber ? `https://wa.me/${env.waDisplayNumber}?text=${encodeURIComponent(ACCOUNT_WORD)}` : null;
    return (
      <main className="page center" dir="rtl">
        <h1 style={{ margin: 0 }}>{t.accountSignedOutTitle}</h1>
        <p style={{ margin: 0 }}>{t.accountSignedOutBody}</p>
        <p className="muted" style={{ margin: 0 }} dir="ltr">
          {en.accountSignedOutBody}
        </p>
        {wa && (
          <a className="btn" href={wa}>
            {t.signInWithWhatsApp} · {en.signInWithWhatsApp}
          </a>
        )}
        <p className="muted" style={{ margin: 0 }}>
          {t.continueManual(ACCOUNT_WORD)}
        </p>
      </main>
    );
  }

  const locale = viewer.uiLocale;
  const t = webCopy(locale);
  const [{ watching, more }, balance] = await Promise.all([getLibrary(viewer.id), getBalance(viewer.id)]);
  const title = (s: { titleAr: string; titleEn: string }) => (locale === "en" ? s.titleEn : s.titleAr);

  return (
    <main dir={dirFor(locale)}>
      <TopBar locale={locale} balance={balance} />
      <div className="page" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <h1 style={{ margin: 0 }}>{t.myAccount}</h1>

        {watching.length > 0 && (
          <section>
            <h2 style={{ marginTop: 0 }}>{t.continueWatching}</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {watching.map((s) => (
                <Link
                  key={s.code}
                  href={s.resume ? `/watch/${s.code}/${s.resume}` : `/series/${s.code}`}
                  style={{ display: "grid", gridTemplateColumns: "72px 1fr", gap: 12, alignItems: "center", color: "inherit", textDecoration: "none" }}
                >
                  <Poster url={s.posterUrl} alt={title(s)} />
                  <div>
                    <strong>{title(s)}</strong>
                    <div className="muted">{s.resume ? t.epOf(s.resume, s.total) : t.finished}</div>
                    {s.resume && (
                      <div style={{ height: 4, background: "#333", borderRadius: 2, marginTop: 6 }}>
                        <div style={{ height: 4, width: `${Math.round(((s.resume - 1) / Math.max(s.total, 1)) * 100)}%`, background: "var(--accent, #e11d48)", borderRadius: 2 }} />
                      </div>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {more.length > 0 && (
          <section>
            <h2 style={{ marginTop: 0 }}>{t.moreSeries}</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
              {more.map((s) => (
                <Link key={s.code} href={`/series/${s.code}`} style={{ color: "inherit", textDecoration: "none", fontSize: 13 }}>
                  <Poster url={s.posterUrl} alt={title(s)} />
                  <div style={{ marginTop: 4 }}>{title(s)}</div>
                </Link>
              ))}
            </div>
          </section>
        )}

        <p className="muted" style={{ fontSize: 13 }}>{t.pinTip}</p>
      </div>
    </main>
  );
}
