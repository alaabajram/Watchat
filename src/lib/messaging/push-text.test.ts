import { describe, expect, it } from "vitest";
import { pushText } from "./runner";

describe("templates sent as web push", () => {
  it("fills the series title and episode and drops WhatsApp bold marks", () => {
    expect(pushText("*{{1}}* · الحلقة {{2}} بانتظارك 👀", ["أسرار البيت", "4"])).toBe("أسرار البيت · الحلقة 4 بانتظارك 👀");
    expect(pushText("Hi {{3}}", ["x"])).toBe("Hi");
  });
});
