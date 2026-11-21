"use client";

// Brand & site form: address, names, logos (upload), colours (live preview), support contacts.

import { useState } from "react";
import { createSiteUpload, saveSiteSettings, type SiteForm } from "@/app/admin/site-actions";
import { sendUpload } from "@/lib/storage/send";
import { cleanSiteUrl, contrast, HEX, inkOn, readableOn } from "@/lib/site/brand";

async function upload(kind: "logo-light" | "logo-dark" | "icon", file: File): Promise<string> {
  if (file.size > 2 * 1048576) throw new Error("Keep logos under 2 MB.");
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  const target = await createSiteUpload(kind, ext);
  await sendUpload(target, file);
  return target.publicUrl;
}

function LogoField({ label, hint, kind, value, onChange, dark }: { label: string; hint: string; kind: "logo-light" | "logo-dark" | "icon"; value: string | null; onChange: (v: string | null) => void; dark?: boolean }) {
  const [status, setStatus] = useState<string | null>(null);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <strong style={{ fontSize: 14 }}>{label}</strong>
      <span className="muted" style={{ fontSize: 13 }}>
        {hint}
      </span>
      <div style={{ background: dark ? "#13101a" : "#f4f2ee", borderRadius: 12, padding: 14, minHeight: 72, display: "grid", placeItems: "center", border: "1px solid var(--a-line)" }}>
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" style={{ maxHeight: kind === "icon" ? 56 : 40, maxWidth: "100%" }} />
        ) : (
          <span className="muted">Using the Watchat default</span>
        )}
      </div>
      <div className="row">
        <label className="abtn secondary" style={{ cursor: "pointer" }}>
          Upload
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            style={{ display: "none" }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              try {
                setStatus("Uploading…");
                onChange(await upload(kind, f));
                setStatus("Uploaded. Save to apply.");
              } catch (err) {
                setStatus(err instanceof Error ? err.message : "Upload failed");
              }
            }}
          />
        </label>
        {value && (
          <button type="button" className="secondary" onClick={() => onChange(null)}>
            Use default
          </button>
        )}
      </div>
      {status && <span className="muted" style={{ fontSize: 13 }}>{status}</span>}
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const ok = HEX.test(value);
  return (
    <label>
      {label}
      <div className="row" style={{ alignItems: "center" }}>
        <input type="color" value={ok ? value : "#000000"} onChange={(e) => onChange(e.target.value)} style={{ width: 48, height: 40, padding: 2 }} />
        <input value={value} onChange={(e) => onChange(e.target.value.trim())} maxLength={7} style={{ width: 110 }} aria-invalid={!ok} />
      </div>
    </label>
  );
}

export function SiteSettingsForm({ initial, detectedUrl }: { initial: SiteForm; detectedUrl: string | null }) {
  const [f, setF] = useState<SiteForm>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = <K extends keyof SiteForm>(k: K, v: SiteForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const urlOk = !f.appUrl.trim() || cleanSiteUrl(f.appUrl) !== null;
  const p = HEX.test(f.colorPrimary) ? f.colorPrimary : "#31e5a0";
  const a = HEX.test(f.colorAccent) ? f.colorAccent : "#ff5a48";

  return (
    <form
      className="card"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg(null);
        try {
          const r = await saveSiteSettings(f);
          setMsg({ ok: r.ok, text: r.message });
        } catch {
          setMsg({ ok: false, text: "Something went wrong. Try again." });
        } finally {
          setBusy(false);
        }
      }}
      style={{ display: "flex", flexDirection: "column", gap: 20 }}
    >
      <section>
        <h2 style={{ marginTop: 0 }}>Site address</h2>
        <label>
          Public address of the viewer site
          <input value={f.appUrl} onChange={(e) => set("appUrl", e.target.value)} placeholder={detectedUrl ?? "https://www.watchat.pro"} aria-invalid={!urlOk} />
        </label>
        <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
          Used in every personal link the bot sends, payment return pages and template buttons. Leave empty to use{" "}
          {detectedUrl ? <code>{detectedUrl}</code> : "the address set on the server"}. The domain itself still has to be connected to the hosting.
          {!urlOk && <span style={{ color: "#b91c1c" }}> Use a full https address.</span>}
        </p>
      </section>

      <section>
        <h2 style={{ marginTop: 0 }}>Name</h2>
        <div className="grid3">
          <label>
            Arabic
            <input dir="rtl" value={f.nameAr} onChange={(e) => set("nameAr", e.target.value)} placeholder="واتشات" maxLength={60} />
          </label>
          <label>
            English
            <input value={f.nameEn} onChange={(e) => set("nameEn", e.target.value)} placeholder="Watchat" maxLength={60} />
          </label>
        </div>
      </section>

      <section>
        <h2 style={{ marginTop: 0 }}>Logos</h2>
        <div className="grid3">
          <LogoField label="Logo on light backgrounds" hint="Home and pages. PNG with a transparent background." kind="logo-light" value={f.logoOnLight} onChange={(v) => set("logoOnLight", v)} />
          <LogoField label="Logo on dark backgrounds" hint="Admin sidebar and the player." kind="logo-dark" value={f.logoOnDark} onChange={(v) => set("logoOnDark", v)} dark />
          <LogoField label="Icon" hint="Square, at least 512×512. Browser tab and home-screen icon." kind="icon" value={f.icon} onChange={(v) => set("icon", v)} />
        </div>
      </section>

      <section>
        <h2 style={{ marginTop: 0 }}>Colours</h2>
        <div className="grid3">
          <ColorField label="Main colour (buttons, highlights)" value={f.colorPrimary} onChange={(v) => set("colorPrimary", v)} />
          <ColorField label="Accent colour (badges, alerts)" value={f.colorAccent} onChange={(v) => set("colorAccent", v)} />
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 12, padding: 14, background: "#fff", border: "1px solid var(--a-line)", borderRadius: 12 }}>
          <span style={{ background: p, color: inkOn(p), padding: "10px 18px", borderRadius: 999, fontWeight: 600 }}>Watch episode 1</span>
          <span style={{ background: a, color: inkOn(a), padding: "4px 10px", borderRadius: 999, fontSize: 13 }}>New</span>
          <a style={{ color: readableOn(p) }}>A link in this colour</a>
          {contrast(inkOn(p), p) < 4.5 && <span style={{ color: "#b45309", fontSize: 13 }}>⚠️ Text on the main colour is hard to read; pick a darker or lighter shade.</span>}
        </div>
      </section>

      <section>
        <h2 style={{ marginTop: 0 }}>Contacts</h2>
        <div className="grid3">
          <label>
            Support email
            <input type="email" value={f.supportEmail} onChange={(e) => set("supportEmail", e.target.value)} placeholder="support@watchat.pro" />
          </label>
          <label>
            Support WhatsApp (with country code)
            <input inputMode="numeric" value={f.supportWhatsapp} onChange={(e) => set("supportWhatsapp", e.target.value)} placeholder="971500000000" />
          </label>
          <label>
            Business enquiries email
            <input type="email" value={f.businessEmail} onChange={(e) => set("businessEmail", e.target.value)} placeholder="partners@watchat.pro" />
          </label>
        </div>
        <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
          Shown on the Terms, Privacy, About and data-deletion pages and the partner page.
        </p>
      </section>

      <div className="row" style={{ alignItems: "center" }}>
        <button type="submit" disabled={busy || !urlOk}>
          {busy ? "Saving…" : "Save brand & site"}
        </button>
        {msg && <span style={{ color: msg.ok ? "#166534" : "#b91c1c" }}>{msg.text}</span>}
      </div>
    </form>
  );
}
