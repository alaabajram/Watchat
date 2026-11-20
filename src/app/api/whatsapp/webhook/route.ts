// WhatsApp Cloud API webhook.
//   GET  — Meta's one-time verification when you save the webhook URL.
//   POST — every inbound message and delivery status. We answer 200 at once and do the work after
//          the response (Meta retries slow or failed webhooks, which would duplicate messages).

import { after, NextResponse, type NextRequest } from "next/server";
import { createSupabaseDeps } from "@/lib/bot/deps-supabase";
import { handleInbound } from "@/lib/bot/flow";
import { env } from "@/lib/env";
import { db } from "@/lib/supabase";
import { parseWebhook } from "@/lib/whatsapp/inbound";
import { isValidSignature } from "@/lib/whatsapp/signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  if (params.get("hub.mode") === "subscribe" && params.get("hub.verify_token") === env.waVerifyToken) {
    return new NextResponse(params.get("hub.challenge") ?? "", { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!isValidSignature(raw, req.headers.get("x-hub-signature-256"), env.waAppSecret)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse("Bad JSON", { status: 400 });
  }

  const { messages, statuses } = parseWebhook(body);

  after(async () => {
    const deps = createSupabaseDeps();

    for (const msg of messages) {
      // De-duplicate: Meta may deliver the same message more than once.
      const { error: dupError } = await db().from("wa_inbound").insert({ wa_message_id: msg.id });
      if (dupError) continue;
      try {
        await handleInbound(msg, deps);
      } catch (err) {
        console.error("[webhook] handleInbound failed", { id: msg.id, err });
      }
    }

    for (const s of statuses) {
      await db()
        .from("wa_messages")
        .update({
          status: s.status,
          error: s.errorTitle ?? null,
          // Pricing comes with sent/delivered statuses; later ones (read) leave it as it is.
          ...(s.pricingCategory ? { category: s.pricingCategory } : {}),
          ...(s.billable !== undefined ? { billable: s.billable } : {}),
          ...(s.pricingType ? { pricing_type: s.pricingType } : {}),
        })
        .eq("wa_message_id", s.waMessageId);
    }
  });

  return NextResponse.json({ received: true });
}
