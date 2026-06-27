// WebLLM agent loop (spec §12). Because WebLLM function-calling is preliminary,
// we drive tools manually: the model is asked to emit a JSON object choosing a
// tool, we parse it, call MCP, feed the result back, and repeat until the model
// answers without a tool call.

import type { McpClient, McpTool } from "./mcp-client";

export type AgentEvent =
  | { type: "status"; text: string }
  | { type: "assistant"; text: string }
  | { type: "tool"; name: string; args: Record<string, unknown>; result: string; isError: boolean };

// Small, tool-capable instruct model. Override via NEXT_PUBLIC_WEBLLM_MODEL.
export const DEFAULT_MODEL =
  process.env.NEXT_PUBLIC_WEBLLM_MODEL || "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";

export interface LoadedEngine {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  engine: any;
  model: string;
}

export async function loadEngine(
  model: string,
  onProgress: (text: string, progress: number) => void,
): Promise<LoadedEngine> {
  const webllm = await import("@mlc-ai/web-llm");
  const engine = await webllm.CreateMLCEngine(model, {
    initProgressCallback: (r: { text: string; progress: number }) => onProgress(r.text, r.progress),
  });
  return { engine, model };
}

function systemPrompt(tools: McpTool[]): string {
  const toolDocs = tools
    .map((t) => `- ${t.name}: ${t.description}\n  args schema: ${JSON.stringify(t.inputSchema)}`)
    .join("\n");
  return `You are an agent that manages records through MCP tools.

Available tools:
${toolDocs}

To use a tool, reply with ONLY a single JSON object, no prose:
{"tool": "<toolName>", "args": { ... }}

When you have finished and want to answer the user, reply with ONLY:
{"final": "<your answer to the user>"}

Rules:
- Output strictly one JSON object per turn. No markdown, no extra text.
- Record ids look like "r1", "r2".
- If a tool returns "403 Forbidden", the current role is not allowed; explain that in your final answer instead of retrying.`;
}

function extractJson(text: string): { tool?: string; args?: Record<string, unknown>; final?: string } | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

export async function runAgent(
  loaded: LoadedEngine,
  userMessage: string,
  tools: McpTool[],
  client: McpClient,
  emit: (e: AgentEvent) => void,
  maxIterations = 5,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [
    { role: "system", content: systemPrompt(tools) },
    { role: "user", content: userMessage },
  ];

  for (let i = 0; i < maxIterations; i++) {
    emit({ type: "status", text: `推論中… (${i + 1}/${maxIterations})` });
    const reply = await loaded.engine.chat.completions.create({
      messages,
      temperature: 0,
      max_tokens: 512,
    });
    const content: string = reply.choices?.[0]?.message?.content ?? "";
    messages.push({ role: "assistant", content });

    const parsed = extractJson(content);
    if (!parsed) {
      emit({ type: "assistant", text: content.trim() || "(空応答)" });
      return;
    }
    if (parsed.final !== undefined) {
      emit({ type: "assistant", text: String(parsed.final) });
      return;
    }
    if (parsed.tool) {
      const args = parsed.args || {};
      try {
        const res = await client.callTool(parsed.tool, args);
        const text = res.content?.map((c) => c.text).join("\n") ?? "";
        emit({ type: "tool", name: parsed.tool, args, result: text, isError: !!res.isError });
        messages.push({
          role: "user",
          content: `Tool ${parsed.tool} result (${res.isError ? "error" : "ok"}):\n${text}`,
        });
      } catch (e) {
        const text = String(e);
        emit({ type: "tool", name: parsed.tool, args, result: text, isError: true });
        messages.push({ role: "user", content: `Tool ${parsed.tool} failed: ${text}` });
      }
      continue;
    }
    emit({ type: "assistant", text: content.trim() });
    return;
  }
  emit({ type: "status", text: "最大反復数に達しました。" });
}
