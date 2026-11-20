// Rules for writing a WhatsApp template (Meta's limits), shared by the admin forms and tests. Pure.
// Placeholders: {{1}} = series title, {{2}} = episode number. A URL button opens the viewer's personal link.

export type TemplateDraft = {
  title: string; // friendly name, e.g. "Come back reminder"
  category: "marketing" | "utility";
  ar: { body: string; button: string };
  en: { body: string; button: string } | null;
};

export const TEMPLATE_LIMITS = { body: 1024, button: 25, name: 512 } as const;
export const OPT_OUT_AR = "أرسل STOP لإيقاف التنبيهات.";
export const OPT_OUT_EN = "Send STOP to turn off alerts.";

/** "Come back reminder" → "come_back_reminder" (Meta: lowercase letters, digits and _). */
export function templateSlug(title: string): string {
  const s = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return s || `template_${Date.now().toString(36)}`;
}

export function templateIssues(d: TemplateDraft): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!d.title.trim()) errors.push("Give the template a name.");
  const check = (label: string, v: { body: string; button: string }) => {
    const body = v.body.trim();
    if (!body) return errors.push(`${label}: the message is empty.`);
    if (Array.from(body).length > TEMPLATE_LIMITS.body) errors.push(`${label}: the message is over ${TEMPLATE_LIMITS.body} characters.`);
    const nums = [...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
    if (nums.some((n) => n !== 1 && n !== 2)) errors.push(`${label}: only [Series title] and [Episode] can be filled in automatically.`);
    if (nums.includes(2) && !nums.includes(1)) errors.push(`${label}: Meta needs [Series title] in the message before you can use [Episode].`);
    if (/^\{\{\d+\}\}/.test(body) || /\{\{\d+\}\}[\s.!؟?…]*$/.test(body)) errors.push(`${label}: Meta doesn't allow a message to start or end with [Series title] or [Episode]; add words around it.`);
    if (/\{\{(?!\d+\}\})|\{(?!\{)[a-z]+\}/i.test(body)) errors.push(`${label}: remove stray curly braces; use the [Series title] and [Episode] buttons instead.`);
    if (Array.from(v.button.trim()).length > TEMPLATE_LIMITS.button) errors.push(`${label}: the button is over ${TEMPLATE_LIMITS.button} characters.`);
    if (d.category === "marketing" && !/STOP/i.test(body)) warnings.push(`${label}: marketing messages should tell people how to stop (e.g. "${label === "Arabic" ? OPT_OUT_AR : OPT_OUT_EN}").`);
  };
  check("Arabic", d.ar);
  if (d.en) check("English", d.en);
  if (d.en && Boolean(d.ar.button.trim()) !== Boolean(d.en.button.trim())) errors.push("Give the button in both languages, or in neither.");
  return { errors, warnings };
}
