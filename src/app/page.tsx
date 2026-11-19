import { env } from "@/lib/env";
import { webCopy } from "@/lib/web-copy";

export const dynamic = "force-dynamic";

export default function Home() {
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
