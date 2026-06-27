// MCP protocol logic (stateless Streamable HTTP, JSON mode) and the CRUD tools.
// The RS route (app/mcp/route.ts) handles the PEP (bearer verification); this
// module handles MCP JSON-RPC dispatch and the PDP (Cedar) check per tool call.

import { authorize, type CedarDecision } from "./cedar";
import { readRecord, writeRecord, deleteRecord, listRecordIds } from "./store";

export const MCP_PROTOCOL_VERSION = "2025-06-18";

export interface AuthInfo {
  sub: string;
  role: string;
  scope: string;
}

export const TOOLS = [
  {
    name: "readRecord",
    description: "Read a record by id. Requires role viewer or higher.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "record id, e.g. r1" } },
      required: ["id"],
    },
  },
  {
    name: "writeRecord",
    description: "Create or update a record. Requires role editor or higher.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        data: { type: "object", description: "arbitrary JSON payload to store" },
      },
      required: ["id", "data"],
    },
  },
  {
    name: "deleteRecord",
    description: "Delete a record by id. Requires role admin.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
] as const;

type JsonRpcId = string | number | null;
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

function result(id: JsonRpcId, res: unknown) {
  return { jsonrpc: "2.0" as const, id, result: res };
}
function rpcError(id: JsonRpcId, code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0" as const, id, error: { code, message, data } };
}
function textContent(text: string, isError = false) {
  return { content: [{ type: "text", text }], isError };
}

interface ToolCallResult {
  response: unknown;
  decision?: CedarDecision;
}

/** Run a single MCP tool call, enforcing Cedar (PDP) before any side effect. */
export function runToolCall(
  toolName: string,
  args: Record<string, unknown>,
  auth: AuthInfo,
): ToolCallResult {
  const id = typeof args.id === "string" ? args.id : "";
  if (!id) {
    return { response: textContent(`missing required argument 'id'`, true) };
  }

  // PDP: Cedar decides role x action x resource (spec §6.4).
  const decision = authorize({ sub: auth.sub, role: auth.role, action: toolName, resourceId: id });
  if (decision.decision !== "allow") {
    return {
      response: textContent(
        `403 Forbidden — Cedar denied '${toolName}' for role '${auth.role}' on Record::"${id}".`,
        true,
      ),
      decision,
    };
  }

  switch (toolName) {
    case "readRecord": {
      const rec = readRecord(id);
      if (!rec) return { response: textContent(`record '${id}' not found`, true), decision };
      return { response: textContent(JSON.stringify(rec, null, 2)), decision };
    }
    case "writeRecord": {
      const data = (args.data ?? {}) as unknown;
      const rec = writeRecord(id, data);
      return { response: textContent(`wrote record:\n${JSON.stringify(rec, null, 2)}`), decision };
    }
    case "deleteRecord": {
      const existed = deleteRecord(id);
      return {
        response: textContent(existed ? `deleted record '${id}'` : `record '${id}' did not exist`),
        decision,
      };
    }
    default:
      return { response: textContent(`unknown tool '${toolName}'`, true), decision };
  }
}

export interface RpcOutcome {
  /** JSON body to return, or null for a notification (no response body). */
  body: unknown | null;
  /** Optional Cedar decision, surfaced for the flow log / verify script. */
  decision?: CedarDecision;
}

/** Handle one JSON-RPC message (request or notification). */
export function handleRpc(msg: JsonRpcRequest, auth: AuthInfo): RpcOutcome {
  const id = msg.id ?? null;
  const isNotification = msg.id === undefined || msg.id === null;

  switch (msg.method) {
    case "initialize":
      return {
        body: result(id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "agent-auth-demo-rs", version: "1.0.0" },
        }),
      };

    case "notifications/initialized":
    case "notifications/cancelled":
      return { body: null };

    case "ping":
      return { body: result(id, {}) };

    case "tools/list":
      return { body: result(id, { tools: TOOLS }) };

    case "tools/call": {
      const params = (msg.params || {}) as { name?: string; arguments?: Record<string, unknown> };
      const name = params.name || "";
      if (!TOOLS.some((t) => t.name === name)) {
        return { body: rpcError(id, -32602, `unknown tool: ${name}`) };
      }
      const { response, decision } = runToolCall(name, params.arguments || {}, auth);
      return { body: result(id, response), decision };
    }

    default:
      if (isNotification) return { body: null };
      return { body: rpcError(id, -32601, `method not found: ${msg.method}`) };
  }
}
