// Outgoing WhatsApp messages and their Cloud API payloads.
// Meta's limits are enforced here so copy changes can never produce a rejected message:
//   reply buttons: max 3, title max 20 chars · list: button 20, row title 24, row description 72, max 10 rows
//   CTA URL button text: 20 chars · body text: 1024 chars

export type MediaHeader = { type: "video" | "image"; link: string };

export type OutMessage =
  | { kind: "text"; body: string }
  | { kind: "video"; link: string; caption?: string }
  | { kind: "image"; link: string; caption?: string }
  | {
      kind: "buttons";
      body: string;
      buttons: { id: string; title: string }[];
      header?: MediaHeader;
      footer?: string;
    }
  | { kind: "cta_url"; body: string; buttonText: string; url: string; header?: MediaHeader; footer?: string }
  | {
      // Pre-approved template: the only kind allowed outside the 24-hour customer service window.
      kind: "template";
      name: string;
      language: "ar" | "en";
      headerImage?: string;
      bodyParams?: string[];
      urlButtonParam?: string; // replaces {{1}} in the template's URL button
      quickReplyPayload?: string; // comes back as the reply id when the viewer taps a quick-reply button
    }
  | {
      kind: "list";
      body: string;
      buttonText: string;
      sections: { title: string; rows: { id: string; title: string; description?: string }[] }[];
    };

export const LIMITS = {
  buttonTitle: 20,
  maxButtons: 3,
  listButton: 20,
  rowTitle: 24,
  rowDescription: 72,
  maxRows: 10,
  ctaText: 20,
  body: 1024,
  caption: 1024,
  footer: 60,
} as const;

/** Cut a string to `max` characters (counting Arabic letters correctly), adding an ellipsis if cut. */
export function clip(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return chars.slice(0, max - 1).join("") + "…";
}

function header(h?: MediaHeader) {
  if (!h) return undefined;
  return h.type === "video" ? { type: "video", video: { link: h.link } } : { type: "image", image: { link: h.link } };
}

/** Build the JSON body for POST /{phone-number-id}/messages. */
export function toGraphPayload(to: string, msg: OutMessage): Record<string, unknown> {
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to };

  switch (msg.kind) {
    case "text":
      return { ...base, type: "text", text: { body: clip(msg.body, 4096), preview_url: false } };

    case "video":
      return {
        ...base,
        type: "video",
        video: { link: msg.link, ...(msg.caption ? { caption: clip(msg.caption, LIMITS.caption) } : {}) },
      };

    case "image":
      return {
        ...base,
        type: "image",
        image: { link: msg.link, ...(msg.caption ? { caption: clip(msg.caption, LIMITS.caption) } : {}) },
      };

    case "buttons":
      return {
        ...base,
        type: "interactive",
        interactive: {
          type: "button",
          ...(msg.header ? { header: header(msg.header) } : {}),
          body: { text: clip(msg.body, LIMITS.body) },
          ...(msg.footer ? { footer: { text: clip(msg.footer, LIMITS.footer) } } : {}),
          action: {
            buttons: msg.buttons.slice(0, LIMITS.maxButtons).map((b) => ({
              type: "reply",
              reply: { id: b.id, title: clip(b.title, LIMITS.buttonTitle) },
            })),
          },
        },
      };

    case "cta_url":
      return {
        ...base,
        type: "interactive",
        interactive: {
          type: "cta_url",
          ...(msg.header ? { header: header(msg.header) } : {}),
          body: { text: clip(msg.body, LIMITS.body) },
          ...(msg.footer ? { footer: { text: clip(msg.footer, LIMITS.footer) } } : {}),
          action: {
            name: "cta_url",
            parameters: { display_text: clip(msg.buttonText, LIMITS.ctaText), url: msg.url },
          },
        },
      };

    case "template": {
      const components: Record<string, unknown>[] = [];
      if (msg.headerImage) components.push({ type: "header", parameters: [{ type: "image", image: { link: msg.headerImage } }] });
      if (msg.bodyParams?.length) {
        components.push({ type: "body", parameters: msg.bodyParams.map((text) => ({ type: "text", text: clip(text, 200) })) });
      }
      if (msg.urlButtonParam) {
        components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: msg.urlButtonParam }] });
      }
      if (msg.quickReplyPayload) {
        components.push({ type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: clip(msg.quickReplyPayload, 128) }] });
      }
      return {
        ...base,
        type: "template",
        template: { name: msg.name, language: { code: msg.language }, ...(components.length ? { components } : {}) },
      };
    }

    case "list": {
      let remaining = LIMITS.maxRows;
      const sections = msg.sections
        .map((s) => {
          const rows = s.rows.slice(0, Math.max(remaining, 0));
          remaining -= rows.length;
          return {
            title: clip(s.title, LIMITS.rowTitle),
            rows: rows.map((r) => ({
              id: r.id,
              title: clip(r.title, LIMITS.rowTitle),
              ...(r.description ? { description: clip(r.description, LIMITS.rowDescription) } : {}),
            })),
          };
        })
        .filter((s) => s.rows.length > 0);
      return {
        ...base,
        type: "interactive",
        interactive: {
          type: "list",
          body: { text: clip(msg.body, LIMITS.body) },
          action: { button: clip(msg.buttonText, LIMITS.listButton), sections },
        },
      };
    }
  }
}
