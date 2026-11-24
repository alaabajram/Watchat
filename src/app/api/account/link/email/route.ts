// "Add an email" (Profile → Sign-in methods): email a one-time link that adds the address to this account
// (opened with a "Continue" tap on /signin/email, like sign-in links).

import { NextResponse, type NextRequest } from "next/server";
import { randomToken, sha256Hex } from "@/lib/crypto";
import { emailReady, sendEmail } from "@/lib/email";
import { allow, clientIp } from "@/lib/security/rate-limit";
import { err, readJson, sameOrigin } from "@/lib/security/request";
import { getSessionViewer } from "@/lib/session";
import { normalizeEmail } from "@/lib/signin/doors";
import { emailHmac } from "@/lib/signin/server";
import { siteUrl } from "@/lib/site/store";
import { currentTenantId, db } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TEXT = {
  ar: { subject: "أضف بريدك إلى حساب واتشات", button: "أضف البريد", note: "يعمل الرابط مرة واحدة خلال ٣٠ دقيقة. إذا لم تطلب ذلك، تجاهل هذه الرسالة." },
  en: { subject: "Add your email to Watchat", button: "Add this email", note: "The link works once, within 30 minutes. If you didn't ask for this, ignore this email." },
};

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return err(403, "forbidden");
  const viewer = await getSessionViewer();
  if (!viewer) return err(401, "signed_out");
  if (!emailReady()) return err(404, "not_configured");
  const body = await readJson<{ email?: string; lang?: string }>(req);
  const email = normalizeEmail(body?.email);
  if (!email) return err(400, "invalid_email");
  const hmac = emailHmac(email);
  if (!(await allow(`link-email-viewer:${viewer.id}`, 5, 900)) || !(await allow(`signin-email:${hmac}`, 3, 900))) return err(429, "slow_down");
  const locale = body?.lang === "en" ? "en" : "ar";
  const token = randomToken(32);
  const { error } = await db()
    .from("email_logins")
    .insert({ tenant_id: await currentTenantId(), email_hmac: hmac, token_hash: sha256Hex(token), next_path: "/me", ui_locale: locale, link_viewer_id: viewer.id, expires_at: new Date(Date.now() + 30 * 60_000).toISOString() });
  if (error) return err(500, "error");
  const url = `${await siteUrl()}/signin/email?token=${token}${locale === "en" ? "&lang=en" : ""}`;
  const t = TEXT[locale];
  const html = `<div dir="${locale === "ar" ? "rtl" : "ltr"}" style="font-family:system-ui,sans-serif;font-size:16px;line-height:1.6;color:#1e1b26;max-width:480px">
<p><a href="${url}" style="display:inline-block;background:#31e5a0;color:#06281b;padding:12px 22px;border-radius:12px;text-decoration:none;font-weight:700">${t.button}</a></p>
<p style="color:#6f6879;font-size:14px">${t.note}</p></div>`;
  await sendEmail(email, t.subject, `${t.button}: ${url}\n\n${t.note}`, html);
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
