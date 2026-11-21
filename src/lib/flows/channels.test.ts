import { describe, expect, it } from "vitest";
import { channelStats } from "./store";
import { sanitizeGraph } from "./sanitize";
import { channelOfAddress, pickChannelFlow, runsFor, SEQUENCE_CHECKS, SHARED_CHECKS, type FlowGraph } from "./types";
import { validateFlow } from "./validate";

describe("channels", () => {
  it("a viewer's chat app comes from their address", () => {
    expect(channelOfAddress("971500000000")).toBe("whatsapp");
    expect(channelOfAddress("tg:42")).toBe("telegram");
    expect(channelOfAddress("+tg:42")).toBe("telegram");
    expect(channelOfAddress(null)).toBe("whatsapp");
  });

  it("one flow runs for both apps; a pair gives each app its own", () => {
    const both = [{ id: "a", channel: "both" as const }];
    expect(pickChannelFlow(both, "telegram")?.id).toBe("a");
    expect(pickChannelFlow(both, "whatsapp")?.id).toBe("a");
    const pair = [
      { id: "wa", channel: "whatsapp" as const },
      { id: "tg", channel: "telegram" as const },
    ];
    expect(pickChannelFlow(pair, "telegram")?.id).toBe("tg");
    expect(pickChannelFlow(pair, "whatsapp")?.id).toBe("wa");
    expect(pickChannelFlow([], "whatsapp")).toBeNull();
  });

  it("sequences run only for the apps they're set to", () => {
    expect(runsFor("both", "telegram")).toBe(true);
    expect(runsFor("whatsapp", "telegram")).toBe(false);
    expect(runsFor("telegram", "telegram")).toBe(true);
    expect(runsFor("telegram", "whatsapp")).toBe(false);
  });

  it('"Viewer is on Telegram" is offered everywhere and survives saving', () => {
    expect(SEQUENCE_CHECKS).toContain("on_telegram");
    expect(SHARED_CHECKS).toContain("on_telegram");
    const g = sanitizeGraph({
      v: 1,
      nodes: [
        { id: "s", position: { x: 0, y: 0 }, data: { kind: "start" } },
        { id: "c", position: { x: 0, y: 100 }, data: { kind: "condition", condition: { check: "on_telegram" } } },
      ],
      edges: [{ id: "e", source: "s", sourceHandle: "next", target: "c" }],
    }) as FlowGraph;
    const cond = g.nodes.find((n) => n.id === "c")!.data;
    expect(cond).toMatchObject({ kind: "condition", condition: { check: "on_telegram" } });
    expect(validateFlow(g, { episodeCount: 10, templates: [], seriesCodes: [] }).some((i) => /sequence flows only/.test(i.message))).toBe(false);
  });

  it("a canvas shows its own app's numbers; one-for-both shows the total and the split", () => {
    const total = { n1: { reached: 10, clicked: 4 } };
    const split = { n1: { whatsapp: { reached: 6, clicked: 2 }, telegram: { reached: 4, clicked: 2 } } };
    expect(channelStats(total, split, "telegram")).toEqual({ n1: { reached: 4, clicked: 2 } });
    expect(channelStats(total, split, "whatsapp")).toEqual({ n1: { reached: 6, clicked: 2 } });
    expect(channelStats(total, split, "both").n1).toMatchObject({ reached: 10, clicked: 4, byChannel: split.n1 });
  });
});
