import { describe, expect, it } from "vitest";
import { templateIssues, templateSlug, type TemplateDraft } from "./template-rules";

const ok: TemplateDraft = {
  title: "Come back reminder",
  category: "marketing",
  ar: { body: "اشتقنا لك! «{{1}}» بانتظارك من الحلقة {{2}} 🍿\n\nأرسل STOP لإيقاف التنبيهات.", button: "كمّل المشاهدة" },
  en: { body: "We missed you! “{{1}}” is waiting at episode {{2}} 🍿\n\nSend STOP to turn off alerts.", button: "Continue watching" },
};

describe("template rules", () => {
  it("accepts a good template and makes a Meta-safe name", () => {
    expect(templateIssues(ok)).toEqual({ errors: [], warnings: [] });
    expect(templateSlug("Come back reminder!")).toBe("come_back_reminder");
    expect(templateSlug("عربي")).toMatch(/^template_/);
  });

  it("catches what Meta rejects", () => {
    const e = (patch: Partial<TemplateDraft>) => templateIssues({ ...ok, ...patch }).errors.join(" ");
    expect(e({ ar: { body: "{{1}} وصل", button: "" } })).toMatch(/start or end/);
    expect(e({ ar: { body: "الحلقة {{2}} جاهزة الحين", button: "" } })).toMatch(/Series title/);
    expect(e({ ar: { body: "مرحبا {{3}} يا", button: "" } })).toMatch(/only/);
    expect(e({ ar: { body: "مرحبا", button: "زر طويل جدا جدا جدا جدا يتجاوز" } })).toMatch(/25/);
    expect(e({ en: { body: "Hi there friend", button: "" } })).toMatch(/both languages/);
  });

  it("reminds marketing templates to include a way to stop", () => {
    const r = templateIssues({ ...ok, ar: { body: "اشتقنا لك! «{{1}}» بانتظارك يا بطل", button: "" }, en: null });
    expect(r.errors).toEqual([]);
    expect(r.warnings.join(" ")).toMatch(/stop/i);
  });
});
