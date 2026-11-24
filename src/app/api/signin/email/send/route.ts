// Email sign-in, step 1: email a one-time link (30 minutes). Always answers "sent" so nobody can test which
// emails have accounts. Limits: 3 links per email and 10 per network every 15 minutes.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { randomToken, sha256Hex } from "@/lib/crypto";
import { emailReady, sendEmail } from "@/lib/email";
import { allow, clientIp } from "@/lib/security/rate-limit";
import { err, readJson, sameOrigin } from "@/lib/security/request";
import { normalizeEmail } from "@/lib/signin/doors";
import { emailHmac, safeNext } from "@/lib/signin/server";
import { siteUrl } from "@/lib/site/store";
import { currentTenantId, db } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TEXT = {
  ar: {
    subject: "رابط الدخول إلى واتشات",
    body: (url: string) => `اضغط الرابط للدخول إلى واتشات. يعمل مرة واحدة خلال ٣٠ دقيقة.\n\n${url}\n\nإذا لم تطلب الدخول، تجاهل هذه الرسالة.`,
    button: "ادخل إلى واتشات",
    note: "يعمل الرابط مرة واحدة خلال ٣٠ دقيقة. إذا لم تطلب الدخول، تجاهل هذه الرسالة.",
  },
  en: {
    subject: "Your Watchat sign-in link",
    body: (url: string) => `Tap the link to sign in to Watchat. It works once, within 30 minutes.\n\n${url}\n\nIf you didn't ask to sign in, ignore this email.`,
    button: "Sign in to Watchat",
    note: "The link works once, within 30 minutes. If you didn't ask to sign in, ignore this email.",
  },
};

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return err(403, "forbidden");
  if (!emailReady()) return err(404, "not_configured");
  const body = await readJson<{ email?: string; to?: string; lang?: string }>(req);
  const email = normalizeEmail(body?.email);
  if (!email) return err(400, "invalid_email");
  const locale = body?.lang === "en" ? "en" : "ar";
  const hmac = emailHmac(email);
  const sent = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  if (!(await allow(`signin-email-ip:${clientIp(req.headers)}`, 10, 900))) return err(429, "slow_down");
  if (!(await allow(`signin-email:${hmac}`, 3, 900))) return sent; // quietly: don't reveal anything about the address

  const token = randomToken(32);
  const tenantId = await currentTenantId();
  const { error } = await db()
    .from("email_logins")
    .insert({ tenant_id: tenantId, email_hmac: hmac, token_hash: sha256Hex(token), next_path: safeNext(body?.to), ui_locale: locale, expires_at: new Date(Date.now() + 30 * 60_000).toISOString() });
  if (error) {
    console.error("[signin] email link", error.message);
    return err(500, "error");
  }
  const url = `${await siteUrl()}/signin/email?token=${token}${locale === "en" ? "&lang=en" : ""}`;
  const t = TEXT[locale];
  const dir = locale === "ar" ? "rtl" : "ltr";
  const html = `<div dir="${dir}" style="font-family:system-ui,sans-serif;font-size:16px;line-height:1.6;color:#1e1b26;max-width:480px">
<p><a href="${escape(url)}" style="display:inline-block;background:#31e5a0;color:#06281b;padding:12px 22px;border-radius:12px;text-decoration:none;font-weight:700">${t.button}</a></p>
<p style="color:#6f6879;font-size:14px">${t.note}</p></div>`;
  await sendEmail(email, t.subject, t.body(url), html);
  return sent;
}
