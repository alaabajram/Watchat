// Parse Meta's webhook body into the few things the bot cares about.

export type InboundMessage = {
  id: string;
  from: string; // wa_id: the viewer's number, digits only, with country code
  timestamp: number;
  profileName?: string;
  kind: "text" | "reply" | "other";
  text?: string;
  replyId?: string; // id of the tapped button or list row
  referral?: { sourceType?: string; sourceId?: string; ctwaClid?: string };
};

export type StatusUpdate = {
  waMessageId: string;
  status: string; // sent | delivered | read | failed
  recipient: string;
  errorTitle?: string;
  pricingCategory?: string;
};

type Json = Record<string, unknown>;

const asArray = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const asObj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});
const asStr = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

export function parseWebhook(body: unknown): { messages: InboundMessage[]; statuses: StatusUpdate[] } {
  const messages: InboundMessage[] = [];
  const statuses: StatusUpdate[] = [];

  for (const entry of asArray(asObj(body).entry)) {
    for (const change of asArray(entry.changes)) {
      const value = asObj(change.value);
      const contacts = asArray(value.contacts);

      for (const m of asArray(value.messages)) {
        const from = asStr(m.from);
        const id = asStr(m.id);
        if (!from || !id) continue;

        const contact = contacts.find((c) => asStr(c.wa_id) === from);
        const profileName = asStr(asObj(asObj(contact).profile).name);
        const type = asStr(m.type);
        const referral = asObj(m.referral);

        const msg: InboundMessage = {
          id,
          from,
          timestamp: Number(asStr(m.timestamp) ?? 0),
          profileName,
          kind: "other",
          ...(Object.keys(referral).length
            ? {
                referral: {
                  sourceType: asStr(referral.source_type),
                  sourceId: asStr(referral.source_id),
                  ctwaClid: asStr(referral.ctwa_clid),
                },
              }
            : {}),
        };

        if (type === "text") {
          msg.kind = "text";
          msg.text = asStr(asObj(m.text).body) ?? "";
        } else if (type === "interactive") {
          const interactive = asObj(m.interactive);
          const reply = asObj(interactive.button_reply ?? interactive.list_reply);
          msg.kind = "reply";
          msg.replyId = asStr(reply.id);
        } else if (type === "button") {
          // Quick-reply button on a template message
          msg.kind = "reply";
          msg.replyId = asStr(asObj(m.button).payload);
        }
        messages.push(msg);
      }

      for (const s of asArray(value.statuses)) {
        const waMessageId = asStr(s.id);
        if (!waMessageId) continue;
        statuses.push({
          waMessageId,
          status: asStr(s.status) ?? "unknown",
          recipient: asStr(s.recipient_id) ?? "",
          errorTitle: asStr(asObj(asArray(s.errors)[0]).title),
          pricingCategory: asStr(asObj(s.pricing).category),
        });
      }
    }
  }
  return { messages, statuses };
}
