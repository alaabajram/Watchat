// P15 Settings — language, signed-in devices, alerts, data deletion.

import Link from "next/link";
import { DeviceButtons, LanguageSwitch } from "@/components/SettingsControls";
import { TopBar } from "@/components/TopBar";
import { deviceLabel, getSessionViewer, listDevices } from "@/lib/session";
import { getBalance } from "@/lib/wallet";
import { dirFor, webCopy } from "@/lib/web-copy";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const viewer = await getSessionViewer();
  const locale = viewer?.uiLocale ?? "ar";
  const t = webCopy(locale);
  if (!viewer) {
    return (
      <main className="page center" dir={dirFor(locale)}>
        <p>{t.signInFromWhatsApp}</p>
      </main>
    );
  }
  const [devices, balance] = await Promise.all([listDevices(viewer.id), getBalance(viewer.id)]);
  const fmt = new Intl.DateTimeFormat(locale === "ar" ? "ar-AE" : "en-AE", { dateStyle: "medium" });

  return (
    <main dir={dirFor(locale)}>
      <TopBar locale={locale} balance={balance} />
      <div className="page" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <h1 style={{ margin: 0 }}>{t.settingsTitle}</h1>
        <section>
          <h2>{t.language}</h2>
          <LanguageSwitch locale={locale} />
        </section>
        <section>
          <h2>{t.devices}</h2>
          <ul className="list" style={{ marginBottom: 12 }}>
            {devices.map((d) => (
              <li key={d.id}>
                <span>
                  {deviceLabel(d.user_agent)}
                  {d.id === viewer.sessionId && <span className="muted"> · {t.thisDevice}</span>}
                </span>
                <span className="muted">{fmt.format(new Date(d.last_seen_at))}</span>
              </li>
            ))}
          </ul>
          <DeviceButtons locale={locale} hasOthers={devices.length > 1} />
        </section>
        <section>
          <h2>{t.alerts}</h2>
          <p className="muted">{t.alertsHelp}</p>
        </section>
        <section>
          <Link href="/data-deletion" className="muted">
            {t.deleteData}
          </Link>{" "}
          · <Link href="/privacy" className="muted">Privacy</Link>
        </section>
      </div>
    </main>
  );
}
