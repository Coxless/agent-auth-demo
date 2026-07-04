// Stateless authorization codes (spec §8.1).
//
// Why JWT instead of an in-memory Map: the /api/authorize and /api/token routes
// run as independent serverless instances on Vercel, so a code written into one
// instance's memory is invisible to the instance that handles the exchange —
// every code exchange failed with `invalid_grant` ("code invalid, expired, or
// already used"). Rather than introduce an external store (Redis/KV), we encode
// the authorization code itself as a short-lived JWT signed with the AS signing
// key. Any instance can verify it against the published JWKS, so no shared
// server-side state is needed (this mirrors how access tokens already work).
//
// Tradeoff: a stateless code cannot be invalidated server-side after a single
// use ("one-time use", spec recommendation). PKCE (the code_verifier checked at
// the token endpoint) still prevents a third party who intercepts the code from
// redeeming it, and the 60s TTL bounds any replay window. Acceptable for this
// learning demo; a production AS would use a server-side one-time store.

import { SignJWT, jwtVerify, createLocalJWKSet } from "jose";
import { getSigningMaterial, getJwks } from "./keys";

const CODE_TTL_SECONDS = 60; // authorization codes are short-lived
const CODE_PURPOSE = "authz_code"; // distinguishes a code from an access token

export interface AuthCodePayload {
  sub: string;
  role: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  redirectUri: string;
  resource: string;
  scope: string;
  clientId: string;
  state?: string;
}

/** Issue an authorization code as a short-lived signed JWT. */
export async function createAuthCode(input: AuthCodePayload): Promise<string> {
  const { privateKey, kid, alg } = await getSigningMaterial();
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    purpose: CODE_PURPOSE,
    role: input.role,
    cc: input.codeChallenge,
    ccm: input.codeChallengeMethod,
    redirect_uri: input.redirectUri,
    resource: input.resource,
    scope: input.scope,
    client_id: input.clientId,
    state: input.state,
  })
    .setProtectedHeader({ alg, kid, typ: "JWT" })
    .setSubject(input.sub)
    .setIssuedAt(now)
    .setExpirationTime(now + CODE_TTL_SECONDS)
    .sign(privateKey);
}

/**
 * Verify and decode an authorization code. Returns null if the code is invalid,
 * expired, or not actually an authorization code (signature/exp are enforced by
 * jose). Unlike a stateful store this does not detect reuse — see the file note.
 */
export async function consumeAuthCode(code: string): Promise<AuthCodePayload | null> {
  const jwks = createLocalJWKSet(await getJwks());
  try {
    const { payload } = await jwtVerify(code, jwks);
    if (payload.purpose !== CODE_PURPOSE) return null;
    return {
      sub: String(payload.sub),
      role: String(payload.role),
      codeChallenge: String(payload.cc),
      codeChallengeMethod: String(payload.ccm),
      redirectUri: String(payload.redirect_uri),
      resource: String(payload.resource),
      scope: String(payload.scope),
      clientId: String(payload.client_id),
      state: payload.state ? String(payload.state) : undefined,
    };
  } catch {
    return null; // bad signature, expired, or malformed
  }
}
