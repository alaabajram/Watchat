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
  customer?: { id?: string };
  card?: { id?: string; last_four?: string };
  payment_agreement?: { id?: string };
};

/** Smallest-unit precision Tap expects: 3 decimals for KWD / BHD / OMR, 2 otherwise. */
const tapAmount = (amount: number, currency: string) => Number(amount.toFixed(["KWD", "BHD", "OMR", "JOD"].includes(currency) ? 3 : 2));

export async function createCharge(params: {
  orderId: string;
  amount: number;
  currency: string;
  description: string;
  /** The viewer's phone; email-only viewers have none and are sent with an address on our own domain instead. */
  phone: { countryCode: string; number: string } | null;
  fallbackEmail?: string;
  redirectUrl: string;
  webhookUrl: string;
  /** Save the card for automatic renewals (needs Tap's "Save Card" feature on the merchant account). */
  saveCard?: boolean;
}): Promise<TapCharge> {
  const res = await fetch(`${TAP_API}/charges`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secretKey()}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      amount: tapAmount(params.amount, params.currency),
      currency: params.currency,
      customer_initiated: true,
      threeDSecure: true,
      save_card: Boolean(params.saveCard),
      description: params.description,
      reference: { transaction: params.orderId, order: params.orderId },
      metadata: { order_id: params.orderId },
      receipt: { email: false, sms: false },
      customer: {
        first_name: "Watchat",
        last_name: "Viewer",
        ...(params.phone ? { phone: { country_code: params.phone.countryCode, number: params.phone.number } } : { email: params.fallbackEmail }),
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

/**
 * Renewal (merchant-initiated): a one-time token from the saved card, then a charge against the payment
 * agreement made on the first, customer-initiated payment. No 3-D Secure, no viewer present.
 */
export async function chargeSavedCard(params: {
  orderId: string;
  amount: number;
  currency: string;
  description: string;
  customerId: string;
  cardId: string;
  agreementId: string;
  webhookUrl: string;
}): Promise<TapCharge> {
  const headers = { Authorization: `Bearer ${secretKey()}`, "Content-Type": "application/json", Accept: "application/json" };
  const tokenRes = await fetch(`${TAP_API}/tokens`, {
    method: "POST",
    headers,
    body: JSON.stringify({ saved_card: { card_id: params.cardId, customer_id: params.customerId } }),
  });
  const token = (await tokenRes.json().catch(() => ({}))) as { id?: string; errors?: { description?: string }[] };
  if (!tokenRes.ok || !token.id) throw new Error(`Tap token failed: ${tokenRes.status} ${token.errors?.[0]?.description ?? ""}`.trim());

  const res = await fetch(`${TAP_API}/charges`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      amount: tapAmount(params.amount, params.currency),
      currency: params.currency,
      customer_initiated: false,
      threeDSecure: false,
      save_card: false,
      payment_agreement: { id: params.agreementId },
      description: params.description,
      reference: { transaction: params.orderId, order: params.orderId },
      metadata: { order_id: params.orderId },
      receipt: { email: false, sms: false },
      customer: { id: params.customerId },
      source: { id: token.id },
      post: { url: params.webhookUrl },
    }),
  });
  const json = (await res.json().catch(() => ({}))) as TapCharge & { errors?: { description?: string }[] };
  if (!res.ok || !json.id) throw new Error(`Tap renewal failed: ${res.status} ${json.errors?.[0]?.description ?? ""}`.trim());
  return json;
}
