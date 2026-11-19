import { describe, expect, it } from "vitest";
import { hmacHex } from "../crypto";
import { parseWebhook } from "./inbound";
import { clip, toGraphPayload } from "./messages";
import { isValidSignature } from "./signature";

describe("toGraphPayload", () => {
  it("clips button titles to 20 characters and keeps max 3 buttons", () => {
    const payload = toGraphPayload("971500000000", {
      kind: "buttons",
      body: "Pick one",
      buttons: [
        { id: "a", title: "This title is far too long for WhatsApp" },
        { id: "b", title: "B" },
        { id: "c", title: "C" },
        { id: "d", title: "D" },
      ],
    }) as { interactive: { action: { buttons: { reply: { title: string } }[] } } };
    const buttons = payload.interactive.action.buttons;
    expect(buttons).toHaveLength(3);
    expect(Array.from(buttons[0].reply.title).length).toBeLessThanOrEqual(20);
  });

  it("counts Arabic characters, not bytes", () => {
    expect(clip("الحلقة التالية", 20)).toBe("الحلقة التالية");
  });

  it("builds a CTA URL message", () => {
    const payload = toGraphPayload("1", { kind: "cta_url", body: "Go", buttonText: "Watch", url: "https://x.test/w/t" });
    expect(payload).toMatchObject({
      type: "interactive",
      interactive: { type: "cta_url", action: { name: "cta_url", parameters: { url: "https://x.test/w/t" } } },
    });
  });
});

describe("webhook", () => {
  it("verifies Meta's signature", () => {
    const body = '{"hello":"world"}';
    const sig = `sha256=${hmacHex("secret", body)}`;
    expect(isValidSignature(body, sig, "secret")).toBe(true);
    expect(isValidSignature(body, sig, "wrong")).toBe(false);
    expect(isValidSignature(body, null, "secret")).toBe(false);
  });

  it("parses text, button replies, referrals and statuses", () => {
    const body = {
      entry: [
        {
          changes: [
            {
              value: {
                contacts: [{ wa_id: "971500000000", profile: { name: "Sara" } }],
                messages: [
                  {
                    id: "wamid.1",
                    from: "971500000000",
                    timestamp: "1700000000",
                    type: "text",
                    text: { body: "SECRETS01" },
                    referral: { source_type: "ad", source_id: "ad-42", ctwa_clid: "clid" },
                  },
                  {
                    id: "wamid.2",
                    from: "971500000000",
                    timestamp: "1700000001",
                    type: "interactive",
                    interactive: { type: "button_reply", button_reply: { id: "ep:next", title: "Next" } },
                  },
                ],
                statuses: [{ id: "wamid.out", status: "delivered", recipient_id: "971500000000" }],
              },
            },
          ],
        },
      ],
    };
    const { messages, statuses } = parseWebhook(body);
    expect(messages[0]).toMatchObject({ kind: "text", text: "SECRETS01", profileName: "Sara", referral: { sourceId: "ad-42" } });
    expect(messages[1]).toMatchObject({ kind: "reply", replyId: "ep:next" });
    expect(statuses[0]).toMatchObject({ waMessageId: "wamid.out", status: "delivered" });
  });
});
