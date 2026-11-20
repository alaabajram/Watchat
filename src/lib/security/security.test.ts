import { describe, expect, it } from "vitest";
import { countryFromPhone, currencyFor } from "../phone";
import { hashPassword, passwordProblem, verifyPassword } from "./password";

describe("admin passwords", () => {
  it("hashes with scrypt and verifies only the right password", async () => {
    const hash = await hashPassword("correct horse 42");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse 42", hash)).toBe(true);
    expect(await verifyPassword("wrong horse 42", hash)).toBe(false);
    expect(await verifyPassword("anything", "not-a-hash")).toBe(false);
  });

  it("rejects weak passwords", () => {
    expect(passwordProblem("short1")).not.toBeNull();
    expect(passwordProblem("onlyletterslong")).not.toBeNull();
    expect(passwordProblem("letters and 123")).toBeNull();
  });
});

describe("country and currency from WhatsApp numbers", () => {
  it("maps Gulf numbers and picks SAR only for Saudi", () => {
    expect(countryFromPhone("971501234567")).toBe("AE");
    expect(countryFromPhone("966501234567")).toBe("SA");
    expect(countryFromPhone("441234567890")).toBeNull();
    expect(currencyFor("SA")).toBe("SAR");
    expect(currencyFor("AE")).toBe("AED");
    expect(currencyFor(null)).toBe("AED");
  });
});
