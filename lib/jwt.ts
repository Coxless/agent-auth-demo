// JWT signing (AS) and verification (RS). Verification mirrors the spec's PEP:
// signature via JWKS, plus iss / aud / exp / scope checks.

import { SignJWT, jwtVerify, createLocalJWKSet, errors, type JWTPayload } from "jose";
import { getSigningMaterial, getJwks } from "./keys";
import { SCOPE, ACCESS_TOKEN_TTL_SECONDS } from "./config";

export interface AccessClaims extends JWTPayload {
  sub: string;
  role: string;
  scope: string;
}

/** AS: issue a short-lived, role-bearing access token (spec §7). No PII. */
export async function signAccessToken(params: {
  iss: string;
  aud: string;
  sub: string;
  role: string;
}): Promise<{ token: string; expiresIn: number }> {
  const { privateKey, kid, alg } = await getSigningMaterial();
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ role: params.role, scope: SCOPE })
    .setProtectedHeader({ alg, kid, typ: "JWT" })
    .setIssuer(params.iss)
    .setAudience(params.aud)
    .setSubject(params.sub)
    .setIssuedAt(now)
    .setExpirationTime(now + ACCESS_TOKEN_TTL_SECONDS)
    .sign(privateKey);
  return { token, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}

export type VerifyOutcome =
  | { ok: true; claims: AccessClaims }
  | { ok: false; status: 401 | 403; error: string; description: string };

/**
 * RS PEP: verify a bearer token. Returns a structured outcome so the route can
 * map to the right OAuth error (invalid_token => 401, insufficient_scope => 403).
 */
export async function verifyAccessToken(
  token: string,
  opts: { issuer: string; audience: string },
): Promise<VerifyOutcome> {
  const jwks = createLocalJWKSet(await getJwks());
  let payload: JWTPayload;
  try {
    const res = await jwtVerify(token, jwks, {
      issuer: opts.issuer,
      audience: opts.audience,
    });
    payload = res.payload;
  } catch (e) {
    if (e instanceof errors.JWTExpired) {
      return { ok: false, status: 401, error: "invalid_token", description: "token expired" };
    }
    if (e instanceof errors.JWTClaimValidationFailed) {
      // wrong iss/aud, etc.
      return { ok: false, status: 401, error: "invalid_token", description: e.message };
    }
    return { ok: false, status: 401, error: "invalid_token", description: "signature/verification failed" };
  }

  const scopes = String(payload.scope || "").split(/\s+/).filter(Boolean);
  if (!scopes.includes(SCOPE)) {
    return {
      ok: false,
      status: 403,
      error: "insufficient_scope",
      description: `required scope '${SCOPE}' missing`,
    };
  }
  if (!payload.sub || typeof (payload as AccessClaims).role !== "string") {
    return { ok: false, status: 401, error: "invalid_token", description: "missing sub/role" };
  }
  return { ok: true, claims: payload as AccessClaims };
}
