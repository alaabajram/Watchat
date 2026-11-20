// "My account" — the one fixed link viewers keep (WhatsApp business profile, pinned message).
// Same address for everyone: the browser's own session decides whose account opens, so a forwarded
// link never opens someone else's. Not signed in → one tap opens WhatsApp to get a sign-in link.
// Coming back here costs no WhatsApp messages.
// Signed in: the profile screen from the design team (profile card, wallet card, menu).

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { BookmarkIcon, ChevronIcon, DocIcon, GiftIcon, GlobeIcon, HelpIcon, PlusIcon, SettingsIcon, ShieldIcon } from "@/components/brand/icons";
import { Splash } from "@/components/brand/Splash";
import { BottomNav } from "@/components/home/BottomNav";
import { SignOutRow } from "@/components/SignOutRow";
import { SiteFooter } from "@/components/site/SiteFooter";
import { TopBar } from "@/components/TopBar";
import { env } from "@/lib/env";
import { ACCOUNT_WORD } from "@/lib/links";
import { getSessionViewer } from "@/lib/session";
import { getPublishedPage, getSiteSafe } from "@/lib/site/store";
import { db } from "@/lib/supabase";
import { getBalance } from "@/lib/wallet";
import { dirFor, webCopy } from "@/lib/web-copy";

export const dynamic = "force-dynamic";
export const metadata = { title: "Watchat · حسابي" };

export default async function MyAccountPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const viewer = await getSessionViewer();
  if (!viewer) {
    // Same look as watchat.pro's splash; one tap opens WhatsApp with «حسابي» ready, the bot replies with a sign-in link.
    const locale = (await searchParams).lang === "en" ? "en" : "ar";
    const t = webCopy(locale);
    const wa = env.waDisplayNumber ? `https://wa.me/${env.waDisplayNumber}?text=${encodeURIComponent(ACCOUNT_WORD)}` : null;
    return <Splash locale={locale} waHref={wa} cta={t.signInWithWhatsApp} hint={wa ? t.accountSignedOutBody : t.continueManual(ACCOUNT_WORD)} path="/me" />;
  }

  const locale = viewer.uiLocale;
  const t = webCopy(locale);
  const rtl = locale === "ar";
  const [balance, site, terms, { count: passes }] = await Promise.all([
    getBalance(viewer.id),
    getSiteSafe(),
    getPublishedPage("terms"),
    db().from("entitlements").select("series_id", { count: "exact", head: true }).eq("viewer_id", viewer.id).is("episode_number", null),
  ]);
  const support = site.supportWhatsapp
    ? `https://wa.me/${site.supportWhatsapp.replace(/\D/g, "")}`
    : site.supportEmail
      ? `mailto:${site.supportEmail}`
      : env.waDisplayNumber
        ? `https://wa.me/${env.waDisplayNumber}`
        : null;
  const shortId = viewer.id.replace(/-/g, "").slice(0, 8).toUpperCase();
  const chevron = <ChevronIcon color="#8a847e" rtl={rtl} />;

  return (
    <div className="wc wc-app" dir={dirFor(locale)} lang={locale}>
      <TopBar locale={locale} balance={balance} />
      <main style={{ maxWidth: 600, margin: "0 auto", padding: "8px 16px 0", display: "flex", flexDirection: "column", gap: 16 }}>
        <h1 className="wc-section-title" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{t.profile}</h1>

        {/* Profile card */}
        <section className="wc-card" style={{ padding: 18, display: "flex", alignItems: "center", gap: 16 }}>
          <span aria-hidden="true" style={{ width: 76, height: 76, flexShrink: 0, borderRadius: "50%", background: "#e3fbf1", border: "4px solid #bff5de", display: "grid", placeItems: "center" }}>
            <img src={site.icon} alt="" style={{ width: 38, height: "auto" }} />
          </span>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            <strong style={{ fontSize: 20, fontWeight: 600 }}>{t.member}</strong>
            <span style={{ fontSize: 13, color: "var(--wc-muted)" }}>
              {t.accountIdLabel} <bdi dir="ltr" style={{ fontFamily: "ui-monospace, monospace", letterSpacing: "0.04em" }}>{shortId}</bdi>
            </span>
            <span style={{ alignSelf: "flex-start", marginTop: 4, display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 12px", borderRadius: 999, background: "#ffece8", border: "1px solid #ffcfc6", color: "var(--wc-coral-text)", fontSize: 13, fontWeight: 600 }}>
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="var(--wc-coral)"><path d="M12 2.5l2.9 6 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.2 1.3-6.6-4.9-4.6 6.6-.8z" /></svg>
              {passes ? t.passHolder : t.freeMember}
            </span>
          </div>
        </section>

        {/* Wallet card */}
        <section className="wc-card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }} aria-labelledby="h-wallet">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h2 id="h-wallet" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 18, fontWeight: 600 }}>
              <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--wc-mint)" }} />
              {t.myWallet}
            </h2>
            <Link href="/wallet" className="wc-link" style={{ display: "inline-flex", alignItems: "center", gap: 2, minHeight: 44 }}>
              {t.viewDetails}
              <ChevronIcon size={16} rtl={rtl} />
            </Link>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span aria-hidden="true" style={{ width: 56, height: 56, borderRadius: 16, background: "#fff4dc", border: "1px solid #fbe3a8", display: "grid", placeItems: "center" }}>
                <span style={{ width: 34, height: 34, borderRadius: "50%", background: "#f5b323", boxShadow: "inset 0 0 0 4px #ffd877" }} />
              </span>
              <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
                <strong style={{ fontSize: 32, fontWeight: 700 }}>{balance}</strong>
                <span style={{ fontSize: 13, color: "var(--wc-muted)" }}>{t.coinsAvailable}</span>
              </span>
            </div>
            <Link href="/store?back=/me" className="wc-btn" style={{ minHeight: 52, fontSize: 16 }}>
              <PlusIcon />
              {t.refillCoins}
            </Link>
          </div>
        </section>

        {/* Menu */}
        <ul className="wc-menu">
          <li>
            <Link href="/store?back=/me">
              <span className="wc-tile" style={{ background: "#ffece8" }}><GiftIcon color="#d6402e" /></span>
              <span className="wc-grow">{t.getCoins}</span>
              {chevron}
            </Link>
          </li>
          <li>
            <Link href="/list">
              <span className="wc-tile" style={{ background: "#e3fbf1" }}><BookmarkIcon size={20} color="#0e9a6a" /></span>
              <span className="wc-grow">{t.myList}</span>
              {chevron}
            </Link>
          </li>
          <li>
            <Link href="/settings">
              <span className="wc-tile" style={{ background: "#e8f2ff" }}><GlobeIcon color="#1f6fd1" /></span>
              <span className="wc-grow">{t.language}</span>
              <span className="wc-value">{t.languageName}</span>
              {chevron}
            </Link>
          </li>
          <li>
            <Link href="/settings">
              <span className="wc-tile" style={{ background: "#f1eaff" }}><SettingsIcon size={20} color="#7a3fe0" /></span>
              <span className="wc-grow">{t.settings}</span>
              {chevron}
            </Link>
          </li>
          {support && (
            <li>
              <a href={support}>
                <span className="wc-tile" style={{ background: "#fff1e3" }}><HelpIcon color="#c4620c" /></span>
                <span className="wc-grow">{t.helpSupport}</span>
                {chevron}
              </a>
            </li>
          )}
          <li>
            <Link href="/privacy">
              <span className="wc-tile" style={{ background: "#e2f7f3" }}><ShieldIcon color="#0e9a7e" /></span>
              <span className="wc-grow">{t.privacyPolicy}</span>
              {chevron}
            </Link>
          </li>
          {terms && (
            <li>
              <Link href="/terms">
                <span className="wc-tile" style={{ background: "#f1eee9" }}><DocIcon color="#4e4943" /></span>
                <span className="wc-grow">{t.terms}</span>
                {chevron}
              </Link>
            </li>
          )}
          <li>
            <SignOutRow label={t.logOut} rtl={rtl} />
          </li>
        </ul>

        <p style={{ fontSize: 13, color: "var(--wc-muted)", textAlign: "center" }}>{t.pinTip}</p>
      </main>
      <SiteFooter locale={locale} />
      <BottomNav locale={locale} current="profile" />
    </div>
  );
}
