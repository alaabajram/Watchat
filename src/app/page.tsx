import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { getSessionViewer } from "@/lib/session";
import { webCopy } from "@/lib/web-copy";

export const dynamic = "force-dynamic";

export default async function Home() {
  // Signed-in viewers land on their account (continue watching, wallet).
  if (await getSessionViewer()) redirect("/me");
  const ar = webCopy("ar");
  const en = webCopy("en");
  const wa = env.waDisplayNumber ? `https://wa.me/${env.waDisplayNumber}?text=MENU` : null;

  return (
    <main className="page center">
      <h1 style={{ margin: 0, fontSize: 40 }}>واتشات · Watchat</h1>
      <p style={{ margin: 0, fontSize: 20 }}>{ar.tagline}</p>
      <p className="muted" style={{ margin: 0 }} dir="ltr">
        {en.tagline}
      </p>
      {wa && (
        <a className="btn" href={wa}>
          {ar.startInWhatsApp}
        </a>
      )}
    </main>
  );
}
