import { describe, expect, it } from "vitest";
import { COPY, SHARED_KEYS } from "./copy";
import { CANVAS_KEYS, mapEdges, RETIRED_KEYS, SHARED_MAP } from "./shared-map";

describe("Shared replies canvas map", () => {
  const onCards = SHARED_MAP.flatMap((c) => (c.kind === "reply" ? c.pieces.map((p) => p.key) : []));

  it("puts every shared text on exactly one card", () => {
    for (const key of CANVAS_KEYS) expect(onCards.filter((k) => k === key), key).toHaveLength(1);
    expect(onCards.length).toBe(CANVAS_KEYS.length);
  });

  it("never shows flow card texts or retired texts", () => {
    for (const key of onCards) {
      expect(SHARED_KEYS).toContain(key);
      expect(RETIRED_KEYS).not.toContain(key);
    }
  });

  it("only uses buttons for button-sized texts", () => {
    for (const c of SHARED_MAP) {
      if (c.kind !== "reply") continue;
      for (const p of c.pieces) {
        const short = p.role === "button" || p.role === "list_button" || p.role === "row" || p.role === "section";
        expect(COPY[p.key].kind === "button", `${c.id}/${p.key}`).toBe(short);
      }
    }
  });

  it("links only to cards that exist, with unique ids", () => {
    const ids = SHARED_MAP.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of mapEdges()) {
      expect(ids).toContain(e.source);
      expect(ids).toContain(e.target);
    }
    for (const c of SHARED_MAP) if (c.kind === "viewer") expect(SHARED_MAP.find((r) => r.id === c.to)?.kind).toBe("reply");
  });
});
