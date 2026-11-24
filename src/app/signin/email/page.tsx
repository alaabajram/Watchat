// The page an email sign-in link opens. One tap finishes it (a POST), so mail scanners that open links can't use
// the one-time link up before the viewer does.

import { EmailFinish } from "@/components/SignInFinish";
import { dirFor } from "@/lib/web-copy";

export const dynamic = "force-dynamic";
export const metadata = { title: "Watchat", robots: { index: false } };

export default async function EmailSignIn({ searchParams }: { searchParams: Promise<{ token?: string; lang?: string }> }) {
  const sp = await searchParams;
  const locale = sp.lang === "en" ? "en" : "ar";
  const token = /^[A-Za-z0-9_-]{20,100}$/.test(sp.token ?? "") ? sp.token! : "";
  return (
    <div className="wc" dir={dirFor(locale)} lang={locale} data-no-chat="">
      <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24 }}>
        <EmailFinish token={token} locale={locale} />
      </main>
    </div>
  );
}
