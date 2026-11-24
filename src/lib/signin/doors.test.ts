import { describe, expect, it } from "vitest";
import { doorsFor, emailAddressFor, isEmailAddress, maskPhone, normalizeEmail, normalizePhone, whatsappWorking } from "./doors";

describe("sign-in doors", () => {
  it("cleans phone numbers into E.164", () => {
    expect(normalizePhone("+971 50 123 4567")).toBe("+971501234567");
    expect(normalizePhone("00971501234567")).toBe("+971501234567");
    expect(normalizePhone("050 123 4567")).toBe("+971501234567");
    expect(normalizePhone("501234567")).toBe("+971501234567");
    expect(normalizePhone("٠٥٠١٢٣٤٥٦٧")).toBe("+971501234567");
    expect(normalizePhone("0551234567", "966")).toBe("+966551234567");
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("+0123456789")).toBeNull();
    expect(normalizePhone(42)).toBeNull();
    expect(maskPhone("+971501234567")).toBe("+97150 ••• 4567");
  });

  it("cleans emails and keeps email-only viewers apart from phones and Telegram", () => {
    expect(normalizeEmail("  Alaa@Watchat.PRO ")).toBe("alaa@watchat.pro");
    expect(normalizeEmail("not an email")).toBeNull();
    expect(normalizeEmail("a@b")).toBeNull();
    expect(emailAddressFor("ab".repeat(32))).toBe(`em:${"ab".repeat(12)}`);
    expect(isEmailAddress("+em:abc")).toBe(true);
    expect(isEmailAddress("+971501234567")).toBe(false);
    expect(isEmailAddress("+tg:123")).toBe(false);
  });

  it("knows when WhatsApp stopped sending", () => {
    const locked = { status: "failed", error: "Business Account locked" };
    const denied = { status: "failed", error: "403 131005 (#131005) Access denied" };
    expect(whatsappWorking([])).toBe(true);
    expect(whatsappWorking([locked, locked, locked])).toBe(false);
    expect(whatsappWorking([locked, denied])).toBe(false);
    expect(whatsappWorking([locked, { status: "delivered", error: null }])).toBe(true);
    expect(whatsappWorking([{ status: "failed", error: "bad number" }, { status: "failed", error: "bad number" }])).toBe(true);
  });

  it("orders the doors by the visitor's chat app and hides what isn't set up", () => {
    expect(doorsFor({ whatsapp: true, telegram: true, phone: true, email: true, prefer: null })).toEqual(["whatsapp", "telegram", "phone", "email"]);
    expect(doorsFor({ whatsapp: true, telegram: true, phone: false, email: true, prefer: "telegram" })).toEqual(["telegram", "whatsapp", "email"]);
    expect(doorsFor({ whatsapp: false, telegram: true, phone: true, email: true, prefer: null })).toEqual(["telegram", "phone", "email"]);
  });
});
