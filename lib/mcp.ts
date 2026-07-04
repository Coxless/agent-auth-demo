// MCP protocol logic (stateless Streamable HTTP, JSON mode) and the CRUD tools.
// The RS route (app/mcp/route.ts) handles the PEP (bearer verification); this
// module handles MCP JSON-RPC dispatch and the PDP (Cedar) check per tool call.

import { authorize, type CedarDecision } from "./cedar";
import { readRecord, writeRecord, deleteRecord, getSensitivity, listRecordIds } from "./store";

export const MCP_PROTOCOL_VERSION = "2025-06-18";

export interface AuthInfo {
  sub: string;
  role: string;
  scope: string;
}

export const TOOLS = [
  {
    name: "readRecord",
    description:
      "Read a record by id. Requires role viewer or higher. Dynamic (ABAC): records " +
      "classified 'confidential' cannot be read by role viewer, even though viewer " +
      "can read ordinary records.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "record id, e.g. r1" } },
      required: ["id"],
    },
  },
  {
    name: "writeRecord",
    description:
      "Create or update a record. Requires role editor or higher. Dynamic (ABAC): " +
      "records classified 'confidential' can only be written by role admin, even " +
      "though editor can write ordinary records.",
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
    description:
      "Delete one or more records. Requires role admin. Dynamic (blast-radius guard): " +
      "pass a single 'id', or 'ids' for several — but deleting more than one record in " +
      "a single call is always denied, even for admin.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "single record id (shorthand for ids: [id])" },
        ids: { type: "array", items: { type: "string" }, description: "record ids to delete" },
      },
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

function denyResponse(toolName: string, auth: AuthInfo, resourceDesc: string): ToolCallResult["response"] {
  return textContent(
    `403 Forbidden — Cedar denied '${toolName}' for role '${auth.role}' on ${resourceDesc}.`,
    true,
  );
}

/** Run a single MCP tool call, enforcing Cedar (PDP) before any side effect. */
export function runToolCall(
  toolName: string,
  args: Record<string, unknown>,
  auth: AuthInfo,
): ToolCallResult {
  if (toolName === "deleteRecord") {
    // Bulk-delete guard (spec §6, dynamic/context-based): accept either a single
    // 'id' or an 'ids' array, but authorize the whole call at once so Cedar can
    // see how many records are targeted (context.targetCount).
    const ids = Array.isArray(args.ids)
      ? args.ids.filter((x): x is string => typeof x === "string")
      : typeof args.id === "string" && args.id
        ? [args.id]
        : [];
    if (ids.length === 0) {
      return { response: textContent(`missing required argument 'id' or 'ids'`, true) };
    }

    const decision = authorize({
      sub: auth.sub,
      role: auth.role,
      action: toolName,
      resourceId: ids[0],
      context: { targetCount: ids.length },
    });
    if (decision.decision !== "allow") {
      const resourceDesc =
        ids.length > 1 ? `${ids.length} records (${ids.join(", ")})` : `Record::"${ids[0]}"`;
      return { response: denyResponse(toolName, auth, resourceDesc), decision };
    }

    const results = ids.map((id) => `'${id}' ${deleteRecord(id) ? "deleted" : "did not exist"}`);
    return { response: textContent(results.join("\n")), decision };
  }

  const id = typeof args.id === "string" ? args.id : "";
  if (!id) {
    return { response: textContent(`missing required argument 'id'`, true) };
  }

  // PDP: Cedar decides role x resource-attributes x action (spec §6.4, ABAC).
  const decision = authorize({
    sub: auth.sub,
    role: auth.role,
    action: toolName,
    resourceId: id,
    resourceSensitivity: getSensitivity(id),
  });
  if (decision.decision !== "allow") {
    return { response: denyResponse(toolName, auth, `Record::"${id}"`), decision };
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
