// AS token endpoint (spec §8.1). Exchanges an authorization code + PKCE verifier
// for a short-lived, role-bearing access token (JWT). Public client: no secret.

import { jsonResponse, corsPreflight } from "@/lib/http";
import { CLIENT_ID, issuer, resourceUrl } from "@/lib/config";
import { consumeAuthCode } from "@/lib/store";
import { verifyPkceS256 } from "@/lib/pkce";
import { signAccessToken } from "@/lib/jwt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

function tokenError(error: string, description: string, status = 400) {
  return jsonResponse({ error, error_description: description }, { status });
}

export async function POST(req: Request) {
  let params: URLSearchParams;
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/x-www-form-urlencoded")) {
    params = new URLSearchParams(await req.text());
  } else if (ct.includes("application/json")) {
    params = new URLSearchParams(Object.entries((await req.json()) as Record<string, string>));
  } else {
    params = new URLSearchParams(await req.text());
  }

  const grantType = params.get("grant_type") || "";
  const code = params.get("code") || "";
  const codeVerifier = params.get("code_verifier") || "";
  const redirectUri = params.get("redirect_uri") || "";
  const clientId = params.get("client_id") || "";

  if (grantType !== "authorization_code")
    return tokenError("unsupported_grant_type", "grant_type must be authorization_code");
  if (!code) return tokenError("invalid_request", "missing code");
  if (!codeVerifier) return tokenError("invalid_request", "missing code_verifier (PKCE required)");

  const stored = consumeAuthCode(code);
  if (!stored) return tokenError("invalid_grant", "code invalid, expired, or already used");
  if (stored.redirectUri !== redirectUri)
    return tokenError("invalid_grant", "redirect_uri mismatch");
  if (clientId && clientId !== CLIENT_ID)
    return tokenError("invalid_client", "client_id mismatch");
  if (clientId !== stored.clientId) return tokenError("invalid_grant", "client_id mismatch");

  const pkceOk = await verifyPkceS256(codeVerifier, stored.codeChallenge);
  if (!pkceOk) return tokenError("invalid_grant", "PKCE verification failed");

  // Bind the token audience to the requested resource (RFC 8707), falling back to
  // this RS. The RS only accepts tokens whose aud is itself.
  const aud = stored.resource || resourceUrl(req);
  const { token, expiresIn } = await signAccessToken({
    iss: issuer(req),
    aud,
    sub: stored.sub,
    role: stored.role,
  });

  return jsonResponse({
    access_token: token,
    token_type: "Bearer",
    expires_in: expiresIn,
    scope: stored.scope,
  });
}
