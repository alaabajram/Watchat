import { env } from "../env";
import { toGraphPayload, type OutMessage } from "./messages";

export type SendResult = { ok: true; waMessageId: string } | { ok: false; error: string };

/** Send one message through the WhatsApp Cloud API. Never throws: failures are returned and logged. */
export async function sendWhatsApp(to: string, msg: OutMessage): Promise<SendResult> {
  const url = `https://graph.facebook.com/${env.waGraphVersion}/${env.waPhoneNumberId}/messages`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.waAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(toGraphPayload(to, msg)),
    });
    const json = (await res.json().catch(() => ({}))) as {
      messages?: { id: string }[];
      error?: { message?: string; code?: number };
    };
    if (!res.ok || !json.messages?.[0]?.id) {
      const error = `${res.status} ${json.error?.code ?? ""} ${json.error?.message ?? "unknown error"}`.trim();
      console.error("[whatsapp] send failed", { kind: msg.kind, error });
      return { ok: false, error };
    }
    return { ok: true, waMessageId: json.messages[0].id };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[whatsapp] send threw", { kind: msg.kind, error });
    return { ok: false, error };
  }
}
