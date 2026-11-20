// Message templates on Meta: submit for approval and sync their status.
// Body placeholders: {{1}} = series title, {{2}} = episode number. URL button: APP_URL/w/{{1}} (personal link).
// Templates with an image header need an example image upload on Meta's side: create those in
// WhatsApp Manager, then use "Sync from Meta" in the admin.

import { siteUrl } from "../site/store";
import { env } from "../env";

export type TemplateRow = {
  id: string;
  name: string;
  lang: "ar" | "en";
  category: "marketing" | "utility";
  header_type: "none" | "image";
  body: string;
  button_text: string | null;
  /** url: the button opens the viewer's personal link. quick_reply: the tap comes back to the bot. */
  button_type?: "url" | "quick_reply";
};

export function placeholderCount(body: string): number {
  const found = body.match(/\{\{(\d+)\}\}/g) ?? [];
  return found.length ? Math.max(...found.map((p) => Number(p.replace(/\D/g, "")))) : 0;
}

const EXAMPLE_PARAMS = ["أسرار البيت", "12", "x", "x", "x"];

function graph(path: string) {
  return `https://graph.facebook.com/${env.waGraphVersion}/${path}`;
}

export function wabaConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_WABA_ID);
}

export async function submitTemplate(t: TemplateRow): Promise<{ ok: true; metaId: string; status: string } | { ok: false; error: string }> {
  const wabaId = process.env.WHATSAPP_WABA_ID;
  if (!wabaId) return { ok: false, error: "Set WHATSAPP_WABA_ID (your Messaging account ID) in Vercel first." };
  if (t.header_type !== "none") {
    return { ok: false, error: "Templates with an image header must be created in WhatsApp Manager, then synced." };
  }
  const res = await fetch(graph(`${wabaId}/message_templates`), {
    method: "POST",
    headers: { Authorization: `Bearer ${env.waAccessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: t.name, language: t.lang, category: t.category.toUpperCase(), components: templateComponents(t, await siteUrl()) }),
  });
  const json = (await res.json().catch(() => ({}))) as { id?: string; status?: string; error?: { message?: string; error_user_msg?: string } };
  if (!res.ok || !json.id) return { ok: false, error: json.error?.error_user_msg ?? json.error?.message ?? `HTTP ${res.status}` };
  return { ok: true, metaId: json.id, status: json.status ?? "PENDING" };
}

function templateComponents(t: Omit<TemplateRow, "id">, base: string): Record<string, unknown>[] {
  const n = placeholderCount(t.body);
  const components: Record<string, unknown>[] = [
    { type: "BODY", text: t.body, ...(n ? { example: { body_text: [EXAMPLE_PARAMS.slice(0, n)] } } : {}) },
  ];
  if (t.button_text && t.button_type === "quick_reply") {
    components.push({ type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: t.button_text }] });
  } else if (t.button_text) {
    components.push({
      type: "BUTTONS",
      buttons: [{ type: "URL", text: t.button_text, url: `${base}/w/{{1}}`, example: [`${base}/w/Xk3exampleToken`] }],
    });
  }
  return components;
}

/**
 * Edit a template Meta already has (approved, rejected or paused). All components are replaced and it
 * goes back to review. Meta allows an approved template one edit a day, ten a month, and no category change.
 */
export async function editTemplateOnMeta(metaId: string, t: Omit<TemplateRow, "id">, opts: { category?: boolean } = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch(graph(metaId), {
    method: "POST",
    headers: { Authorization: `Bearer ${env.waAccessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ components: templateComponents(t, await siteUrl()), ...(opts.category ? { category: t.category.toUpperCase() } : {}) }),
  });
  const json = (await res.json().catch(() => ({}))) as { success?: boolean; error?: { message?: string; error_user_msg?: string } };
  if (!res.ok || !json.success) return { ok: false, error: json.error?.error_user_msg ?? json.error?.message ?? `HTTP ${res.status}` };
  return { ok: true };
}

export type MetaTemplate = {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  rejected_reason?: string;
  components?: { type: string; format?: string; text?: string; buttons?: { type: string; text?: string }[] }[];
};

export async function fetchMetaTemplates(): Promise<MetaTemplate[]> {
  const wabaId = process.env.WHATSAPP_WABA_ID;
  if (!wabaId) throw new Error("Set WHATSAPP_WABA_ID (your Messaging account ID) in Vercel first.");
  const out: MetaTemplate[] = [];
  let url: string | null = graph(`${wabaId}/message_templates?fields=id,name,language,status,category,rejected_reason,components&limit=100`);
  for (let page = 0; url && page < 10; page++) {
    const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${env.waAccessToken}` } });
    const json = (await res.json()) as { data?: MetaTemplate[]; paging?: { next?: string }; error?: { message?: string } };
    if (!res.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
    out.push(...(json.data ?? []));
    url = json.paging?.next ?? null;
  }
  return out;
}
