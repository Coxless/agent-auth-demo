// Minimal browser MCP client speaking Streamable HTTP in JSON mode (single POST
// per JSON-RPC request, Authorization: Bearer). Kept dependency-free and
// SSE-free for reliability; behaves like the SDK's StreamableHTTPClientTransport
// for the request/response calls this demo needs (initialize, tools/list,
// tools/call).

import type { LogFn } from "./oauth";

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface ToolCallContent {
  content: { type: string; text?: string }[];
  isError?: boolean;
}

export class McpClient {
  private nextId = 1;
  constructor(
    private url: string,
    private token: string,
  ) {}

  private async rpc<T>(method: string, params?: unknown): Promise<T> {
    const id = this.nextId++;
    const res = await fetch(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    if (res.status === 401 || res.status === 403) {
      const detail = await res.text();
      throw new Error(`MCP ${res.status}: ${detail}`);
    }
    const json = await res.json();
    if (json.error) throw new Error(`RPC error ${json.error.code}: ${json.error.message}`);
    return json.result as T;
  }

  async initialize(): Promise<unknown> {
    const result = await this.rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "agent-auth-demo-spa", version: "1.0.0" },
    });
    // notifications/initialized (no response expected)
    await fetch(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    }).catch(() => {});
    return result;
  }

  async listTools(): Promise<McpTool[]> {
    const r = await this.rpc<{ tools: McpTool[] }>("tools/list");
    return r.tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolCallContent> {
    return this.rpc<ToolCallContent>("tools/call", { name, arguments: args });
  }
}

/** Convenience: call a tool and emit a flow-log entry (request + result). */
export async function callToolLogged(
  client: McpClient,
  name: string,
  args: Record<string, unknown>,
  log: LogFn,
): Promise<ToolCallContent> {
  log(`MCP tools/call: ${name}`, "info", args);
  try {
    const res = await client.callTool(name, args);
    const text = res.content?.map((c) => c.text).join("\n") ?? "";
    log(
      `   → ${name} ${res.isError ? "denied/error (Cedar PDP)" : "allow"}`,
      res.isError ? "err" : "ok",
      text,
    );
    return res;
  } catch (e) {
    log(`   → ${name} 失敗`, "err", String(e));
    throw e;
  }
}
