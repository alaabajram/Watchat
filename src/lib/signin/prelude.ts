// Phone sign-in codes through Prelude Verify (https://api.prelude.dev/v2): one call sends (or re-sends) the
// code to a number, one call checks it. Prelude picks the route, blocks fraud (bots that pump codes to costly
// numbers) and deals with sender names per country. Key in Vercel: PRELUDE_API_KEY (v2 key, Sensitive).

const API = "https://api.prelude.dev/v2";

export const preludeReady = () => Boolean(process.env.PRELUDE_API_KEY);

export type SendResult = { ok: true } | { ok: false; reason: "blocked" | "invalid_number" | "not_configured" | "slow_down" | "error" };
export type CheckResult = { ok: true } | { ok: false; reason: "wrong_code" | "expired" | "slow_down" | "not_configured" | "error" };

async function call(path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.PRELUDE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: ((await res.json().catch(() => ({}))) as Record<string, unknown>) ?? {} };
}

/** Send (or, within the same window, re-send) a code. Signals help Prelude spot fraud. */
export async function sendPhoneCode(e164: string, s: { ip: string; userAgent: string | null; locale: "ar" | "en"; existing: boolean }): Promise<SendResult> {
  if (!preludeReady()) return { ok: false, reason: "not_configured" };
  try {
    const { status, json } = await call("/verification", {
      target: { type: "phone_number", value: e164 },
      signals: { ip: s.ip !== "unknown" ? s.ip : undefined, device_platform: "web", user_agent: s.userAgent?.slice(0, 400) ?? undefined, existing_user: s.existing },
      options: { locale: s.locale === "ar" ? "ar" : "en-GB", code_size: 6 },
    });
    if (status === 429) return { ok: false, reason: "slow_down" };
    if (status >= 400) {
      console.error("[prelude] send failed", status, json.code ?? json.message);
      return { ok: false, reason: /phone/i.test(String(json.param ?? json.message ?? "")) ? "invalid_number" : "error" };
    }
    const st = String(json.status ?? "");
    if (st === "success" || st === "retry") return { ok: true };
    if (st === "blocked" || st === "shadow_blocked") return { ok: false, reason: /invalid_phone/.test(String(json.reason)) ? "invalid_number" : "blocked" };
    // "challenged" needs an extra browser check we don't run: treat as blocked (the page offers other ways in).
    return { ok: false, reason: "blocked" };
  } catch (e) {
    console.error("[prelude] send threw", e instanceof Error ? e.message : e);
    return { ok: false, reason: "error" };
  }
}

export async function checkPhoneCode(e164: string, code: string): Promise<CheckResult> {
  if (!preludeReady()) return { ok: false, reason: "not_configured" };
  try {
    const { status, json } = await call("/verification/check", { target: { type: "phone_number", value: e164 }, code });
    if (status === 429) return { ok: false, reason: "slow_down" };
    if (status >= 400) return { ok: false, reason: "error" };
    const st = String(json.status ?? "");
    if (st === "success") return { ok: true };
    if (st === "expired_or_not_found") return { ok: false, reason: "expired" };
    return { ok: false, reason: "wrong_code" };
  } catch {
    return { ok: false, reason: "error" };
  }
}
