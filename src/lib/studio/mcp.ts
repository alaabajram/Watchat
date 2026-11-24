// A small Model Context Protocol server core (JSON-RPC over Streamable HTTP, JSON responses only): enough for
// Claude's custom connectors — initialize, ping, tools/list, tools/call. Pure: tools are passed in.

export type JsonSchema = { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
export type Tool<Ctx> = {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  /** Read-only tools get the hint, so Claude can run them without asking each time. */
  readOnly?: boolean;
  run: (args: Record<string, unknown>, ctx: Ctx) => Promise<unknown>;
};

type RpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
type RpcResponse = { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

export const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

/** An error the tool wants Claude to read (shown as a tool error, not a protocol failure). */
export class ToolError extends Error {}

export async function handleRpc<Ctx>(
  body: unknown,
  server: { name: string; version: string; instructions: string; tools: Tool<Ctx>[] },
  ctx: Ctx,
): Promise<RpcResponse | RpcResponse[] | null> {
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((b) => one(b, server, ctx)))).filter((r): r is RpcResponse => r !== null);
    return out.length ? out : null;
  }
  return one(body, server, ctx);
}

async function one<Ctx>(raw: unknown, server: { name: string; version: string; instructions: string; tools: Tool<Ctx>[] }, ctx: Ctx): Promise<RpcResponse | null> {
  const req = (raw && typeof raw === "object" ? raw : {}) as RpcRequest;
  const id = req.id ?? null;
  const isNotification = req.id === undefined;
  const fail = (code: number, message: string): RpcResponse | null => (isNotification ? null : { jsonrpc: "2.0", id, error: { code, message } });
  const ok = (result: unknown): RpcResponse | null => (isNotification ? null : { jsonrpc: "2.0", id, result });

  if (req.jsonrpc !== "2.0" || typeof req.method !== "string") return fail(-32600, "Invalid request");
  switch (req.method) {
    case "initialize": {
      const asked = typeof req.params?.protocolVersion === "string" ? req.params.protocolVersion : "";
      return ok({
        protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: server.name, version: server.version },
        instructions: server.instructions,
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({
        tools: server.tools.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: { title: t.title, readOnlyHint: Boolean(t.readOnly), destructiveHint: false, openWorldHint: false },
        })),
      });
    case "tools/call": {
      const name = req.params?.name;
      const tool = server.tools.find((t) => t.name === name);
      if (!tool) return fail(-32602, `Unknown tool: ${String(name)}`);
      const args = req.params?.arguments && typeof req.params.arguments === "object" ? (req.params.arguments as Record<string, unknown>) : {};
      try {
        const result = await tool.run(args, ctx);
        return ok({ content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result) }] });
      } catch (e) {
        const message = e instanceof ToolError || e instanceof Error ? e.message : "The tool failed.";
        return ok({ content: [{ type: "text", text: message }], isError: true });
      }
    }
    default:
      if (req.method.startsWith("notifications/")) return null;
      return fail(-32601, `Method not found: ${req.method}`);
  }
}
