import { describe, expect, it } from "vitest";
import { COPY } from "../bot/copy";
import { sanitizeGraph } from "./sanitize";
import { matchKeyword, standardSharedFlow } from "./shared";
import type { FlowGraph } from "./types";
import { validateFlow, validateShared } from "./validate";

const errors = (g: FlowGraph) => validateShared(g, { seriesCodes: ["SECRETS01"] }).filter((i) => i.level === "error");

describe("shared flow (Shared replies)", () => {
  it("the standard shared flow is valid, survives sanitizing, and uses the saved texts", () => {
    const g = standardSharedFlow((k) => (k === "menuBody" ? { ar: "هلا! كيف نساعدك؟", en: "Hi! How can we help?" } : { ar: COPY[k].ar, en: COPY[k].en }));
    expect(validateShared(g, { seriesCodes: [] })).toEqual([]); // no errors, no warnings
    expect(sanitizeGraph(JSON.parse(JSON.stringify(g)))).toEqual(g);
    expect(g.nodes.find((n) => n.id === "menu")?.data).toMatchObject({ kind: "list", body: { ar: "هلا! كيف نساعدك؟" } });
  });

  it("matches words loosely (case, spaces, punctuation, Arabic digits) and falls back to anything else", () => {
    const g = standardSharedFlow();
    expect(matchKeyword(g, " Menu!! ", { allowCatchAll: false })?.id).toBe("k_menu");
    expect(matchKeyword(g, "حسابي", { allowCatchAll: false })?.id).toBe("k_account");
    expect(matchKeyword(g, "delete my data", { allowCatchAll: false })?.id).toBe("k_delete");
    expect(matchKeyword(g, "what?", { allowCatchAll: false })).toBeNull();
    expect(matchKeyword(g, "what?", { allowCatchAll: true })?.id).toBe("k_else");
  });

  it("refuses duplicate words, series codes as words, a second catch-all and series-only cards", () => {
    const g = standardSharedFlow();
    const dup: FlowGraph = {
      ...g,
      nodes: [
        ...g.nodes,
        { id: "k_dup", position: { x: 0, y: 0 }, data: { kind: "keyword", words: ["menu", "SECRETS01"], anythingElse: true } },
        { id: "ep", position: { x: 0, y: 0 }, data: { kind: "wait", minutes: 60 } },
      ],
      edges: [...g.edges, { id: "e_dup", source: "k_dup", sourceHandle: "next", target: "menu" }],
    };
    const msgs = errors(dup).map((i) => i.message).join("\n");
    expect(msgs).toMatch(/two “Viewer sends” cards/);
    expect(msgs).toMatch(/series code/);
    expect(msgs).toMatch(/Only one “Viewer sends” card can catch anything else/);
    expect(msgs).toMatch(/Wait can't be used in Shared replies/);
  });

  it("checks menu list limits and needs every keyword connected", () => {
    const g: FlowGraph = {
      v: 1,
      nodes: [
        { id: "k", position: { x: 0, y: 0 }, data: { kind: "keyword", words: ["hi"], anythingElse: false } },
        {
          id: "l",
          position: { x: 0, y: 0 },
          data: { kind: "list", body: { ar: "قائمة", en: "Menu" }, button: { ar: "القائمة", en: "Menu" }, section: { ar: "x", en: "x" }, rows: Array.from({ length: 11 }, (_, i) => ({ id: `r${i}`, title: { ar: `صف ${i}`, en: `Row ${i}` } })) },
        },
      ],
      edges: [],
    };
    const msgs = errors(g).map((i) => i.message).join("\n");
    expect(msgs).toMatch(/at most 10 rows/);
    expect(msgs).toMatch(/Connect this “Viewer sends” card/);
  });

  it("series flows refuse shared-only cards", () => {
    const g = standardSharedFlow();
    const issues = validateFlow(g, { episodeCount: 10, templates: [] }).filter((i) => i.level === "error").map((i) => i.message).join("\n");
    expect(issues).toMatch(/belong to Shared replies/);
  });
});
