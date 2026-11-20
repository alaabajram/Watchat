// Tap Payments (UAE + KSA): hosted checkout with Apple Pay, Google Pay, cards and mada.
// We never trust the browser or the webhook body: every result is re-read from Tap's API with our
// secret key, and the amount and currency are checked against our own order before anything is granted.

const TAP_API = "https://api.tap.company/v2";

function secretKey(): string {
  const key = process.env.TAP_SECRET_KEY;
  if (!key) throw new Error("Missing TAP_SECRET_KEY (Tap dashboard → goSell → API credentials)");
  return key;
}

export function tapConfigured(): boolean {
  return Boolean(process.env.TAP_SECRET_KEY);
}

export type TapCharge = {
  id: string;
  status: string; // INITIATED | CAPTURED | FAILED | DECLINED | CANCELLED | ABANDONED | …
  amount: number;
  currency: string;
  reference?: { order?: string; transaction?: string };
  metadata?: Record<string, string>;
  transaction?: { url?: string };
  response?: { code?: string; message?: string };
};

export async function createCharge(params: {
  orderId: string;
  amount: number;
  currency: "AED" | "SAR";
  description: string;
  phone: { countryCode: string; number: string };
  redirectUrl: string;
  webhookUrl: string;
}): Promise<TapCharge> {
  const res = await fetch(`${TAP_API}/charges`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secretKey()}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      amount: params.amount,
      currency: params.currency,
      customer_initiated: true,
      threeDSecure: true,
      save_card: false,
      description: params.description,
      reference: { transaction: params.orderId, order: params.orderId },
      metadata: { order_id: params.orderId },
      receipt: { email: false, sms: false },
      customer: {
        first_name: "Watchat",
        last_name: "Viewer",
        phone: { country_code: params.phone.countryCode, number: params.phone.number },
      },
      source: { id: "src_all" },
      post: { url: params.webhookUrl },
      redirect: { url: params.redirectUrl },
    }),
  });
  const json = (await res.json().catch(() => ({}))) as TapCharge & { errors?: { description?: string }[] };
  if (!res.ok || !json.id) {
    throw new Error(`Tap createCharge failed: ${res.status} ${json.errors?.[0]?.description ?? ""}`.trim());
  }
  return json;
}

export async function getCharge(chargeId: string): Promise<TapCharge | null> {
  if (!/^chg_[A-Za-z0-9]+$/.test(chargeId)) return null;
  const res = await fetch(`${TAP_API}/charges/${chargeId}`, {
    headers: { Authorization: `Bearer ${secretKey()}`, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) return null;
  return (await res.json()) as TapCharge;
}
