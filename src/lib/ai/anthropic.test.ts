import { afterEach, describe, expect, it, vi } from "vitest";
import { AiError, callTool } from "./anthropic";

const tool = { name: "reply", description: "Reply", input_schema: { type: "object", properties: {} } };
const opts = { apiKey: "sk-ant-x", model: "claude-sonnet-5-5", system: "s", turns: [{ role: "user" as const, content: "hi" }], tool };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("Claude client", () => {
  it("uses auto tool choice with a strict tool (forced tools 400 on Sonnet/Opus 5.5)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { content: [{ type: "tool_use", name: "reply", input: { ok: 1 } }], usage: { input_tokens: 5, output_tokens: 2 } }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await callTool(opts);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.tool_choice).toEqual({ type: "auto" });
    expect(sent.tools[0].strict).toBe(true);
    expect(r).toEqual({ input: { ok: 1 }, inputTokens: 5, outputTokens: 2 });
  });

  it("asks again once when the model answers in prose", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(200, { content: [{ type: "text", text: "Sure!" }], usage: { input_tokens: 5, output_tokens: 3 } }))
      .mockResolvedValueOnce(json(200, { content: [{ type: "tool_use", name: "reply", input: {} }], usage: { input_tokens: 6, output_tokens: 2 } }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await callTool(opts);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(r.inputTokens).toBe(11);
  });

  it("shows Anthropic's reason for a 400", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(400, { error: { message: "model: unknown model" } })));
    await expect(callTool(opts)).rejects.toThrow(AiError);
    await expect(callTool(opts)).rejects.toThrow(/unknown model/);
  });
});
