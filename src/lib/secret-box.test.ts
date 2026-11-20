import { describe, expect, it } from "vitest";
import { openSecret, sealSecret } from "./secret-box";

const KEY = "x".repeat(40);

describe("secret box", () => {
  it("round-trips and never stores the plain key", () => {
    const sealed = sealSecret("sk-ant-test-123", KEY);
    expect(sealed).not.toContain("sk-ant");
    expect(openSecret(sealed, KEY)).toBe("sk-ant-test-123");
    expect(sealSecret("same", KEY)).not.toBe(sealSecret("same", KEY)); // random IV
  });

  it("refuses the wrong key or a tampered value", () => {
    const sealed = sealSecret("secret", KEY);
    expect(() => openSecret(sealed, "y".repeat(40))).toThrow();
    const parts = sealed.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => openSecret(parts.join("."), KEY)).toThrow();
  });
});
