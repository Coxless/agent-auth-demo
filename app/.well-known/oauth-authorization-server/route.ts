// AS metadata (RFC 8414). Discovered after the SPA learns the AS from the PRM.
import { jsonResponse, corsPreflight } from "@/lib/http";
import { issuer, jwksUri, SCOPE } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

export function GET(req: Request) {
  const iss = issuer(req);
  return jsonResponse({
    issuer: iss,
    authorization_endpoint: `${iss}/authorize`,
    token_endpoint: `${iss}/api/token`,
    jwks_uri: jwksUri(req),
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"], // public client + PKCE
    scopes_supported: [SCOPE],
  });
}
