// Protected Resource Metadata (RFC 9728), spec §8.2. Advertises which AS protects
// this MCP resource. The SPA reaches this after the initial 401 from /mcp.
import { jsonResponse, corsPreflight } from "@/lib/http";
import { issuer, resourceUrl, SCOPE } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

export function GET(req: Request) {
  return jsonResponse({
    resource: resourceUrl(req),
    authorization_servers: [issuer(req)],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
  });
}
