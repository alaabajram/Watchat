// Minimal Claude Messages API client: one forced tool call, so the model can only answer in our format.
// Server-only; the label's key never reaches the browser.

export const AI_MODELS = [
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (recommended)" },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 (best writing, slower)" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (fastest, cheapest)" },
] as const;
export const DEFAULT_MODEL = AI_MODELS[0].id;
export const isKnownModel = (m: string) => AI_MODELS.some((x) => x.id === m);

export type Tool = { name: string; description: string; input_schema: Record<string, unknown> };
export type ChatTurn = { role: "user" | "assistant"; content: string };
export type ToolResult = { input: unknown; inputTokens: number; outputTokens: number };

export class AiError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

function friendly(status: number, detail: string): string {
  if (status === 401 || status === 403) return "The AI key was rejected. Check it in Admin → AI account.";
  if (status === 404) return "This model isn't available on your AI account. Pick another in Admin → AI account.";
  if (status === 429) return "Your AI account hit its rate limit. Try again in a minute.";
  if (status === 400 && /credit|billing/i.test(detail)) return "Your AI account has no credit left. Top it up in the Anthropic console.";
  if (status === 529 || status >= 500) return "The AI service is busy. Try again in a minute.";
  return `AI request failed (${status}).`;
}

export async function callTool(opts: {
  apiKey: string;
  model: string;
  system: string;
  turns: ChatTurn[];
  tool: Tool;
  maxTokens?: number;
}): Promise<ToolResult> {
  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": opts.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: opts.maxTokens ?? 8000,
        system: opts.system,
        messages: opts.turns,
        tools: [opts.tool],
        tool_choice: { type: "tool", name: opts.tool.name },
      }),
      signal: AbortSignal.timeout(110_000),
    });
  } catch (e) {
    throw new AiError(e instanceof Error && e.name === "TimeoutError" ? "The AI took too long. Try a shorter request." : "Couldn't reach the AI service.");
  }
  const body = (await res.json().catch(() => ({}))) as {
    content?: { type: string; name?: string; input?: unknown }[];
    usage?: { input_tokens?: number; output_tokens?: number };
    error?: { message?: string };
  };
  if (!res.ok) throw new AiError(friendly(res.status, body.error?.message ?? ""), res.status);
  const block = body.content?.find((c) => c.type === "tool_use" && c.name === opts.tool.name);
  if (!block) throw new AiError("The AI didn't return a draft. Try again.");
  return { input: block.input, inputTokens: body.usage?.input_tokens ?? 0, outputTokens: body.usage?.output_tokens ?? 0 };
}
