// MCP Resource Server endpoint (spec §8.2). Stateless Streamable HTTP in JSON
// mode: POST a JSON-RPC message (or batch), get a JSON-RPC response.
//
//   PEP: bearer token verified here (signature via JWKS, iss/aud/exp/scope).
//   PDP: Cedar runs inside each tools/call (see lib/mcp.ts).

import { issuer, resourceUrl, prmUrl } from "@/lib/config";
import { verifyAccessToken } from "@/lib/jwt";
import { CORS_HEADERS, corsPreflight } from "@/lib/http";
import { handleRpc, type JsonRpcRequest, type AuthInfo } from "@/lib/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

// GET would be the SSE stream in stateful mode; we are stateless JSON-only.
export function GET(req: Request) {
  return unauthorizedIfNeeded(req) ?? methodNotAllowed();
}

function methodNotAllowed() {
  return new Response(JSON.stringify({ error: "method_not_allowed" }), {
    status: 405,
    headers: { "Content-Type": "application/json", Allow: "POST, OPTIONS", ...CORS_HEADERS },
  });
}

function wwwAuthenticate(req: Request, error?: string, description?: string): string {
  const parts = [`Bearer resource_metadata="${prmUrl(req)}"`];
  if (error) parts.push(`error="${error}"`);
  if (description) parts.push(`error_description="${description.replace(/"/g, "'")}"`);
  return parts.join(", ");
}

function challenge(req: Request, status: 401 | 403, error: string, description: string): Response {
  return new Response(JSON.stringify({ error, error_description: description }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": wwwAuthenticate(req, error, description),
      ...CORS_HEADERS,
    },
  });
}

// For GET we still emit the 401 challenge when there is no token, to aid discovery.
function unauthorizedIfNeeded(req: Request): Response | null {
  const auth = req.headers.get("authorization");
  if (!auth) return challenge(req, 401, "invalid_token", "missing bearer token");
  return null;
}

export async function POST(req: Request) {
  // --- PEP: bearer auth ---
  const header = req.headers.get("authorization") || "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    return challenge(req, 401, "invalid_token", "missing bearer token");
  }
  const verdict = await verifyAccessToken(m[1], {
    issuer: issuer(req),
    audience: resourceUrl(req),
  });
  if (!verdict.ok) {
    return challenge(req, verdict.status, verdict.error, verdict.description);
  }
  const auth: AuthInfo = {
    sub: verdict.claims.sub,
    role: verdict.claims.role,
    scope: verdict.claims.scope,
  };

  // --- MCP JSON-RPC dispatch ---
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }),
      { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
    );
  }

  const messages = Array.isArray(payload) ? payload : [payload];
  const responses: unknown[] = [];
  for (const msg of messages) {
    const outcome = handleRpc(msg as JsonRpcRequest, auth);
    if (outcome.body !== null) responses.push(outcome.body);
  }

  // Only notifications => 202 Accepted, no body (Streamable HTTP).
  if (responses.length === 0) {
    return new Response(null, { status: 202, headers: { ...CORS_HEADERS } });
  }

  const body = Array.isArray(payload) ? responses : responses[0];
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS_HEADERS },
  });
}
