// AS: turns a chosen user + OAuth request into a one-time authorization code,
// then 302-redirects back to the registered SPA redirect_uri (spec §8.1).

import { NextResponse } from "next/server";
import { USERS, CLIENT_ID, SCOPE, allowedRedirectUri, resourceUrl } from "@/lib/config";
import { createAuthCode } from "@/lib/authcode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorRedirect(redirectUri: string, state: string, error: string, desc: string) {
  const u = new URL(redirectUri);
  u.searchParams.set("error", error);
  u.searchParams.set("error_description", desc);
  if (state) u.searchParams.set("state", state);
  return NextResponse.redirect(u.toString(), 302);
}

export async function POST(req: Request) {
  const form = await req.formData();
  const get = (k: string) => String(form.get(k) ?? "");

  const userKey = get("user");
  const redirectUri = get("redirect_uri");
  const state = get("state");
  const responseType = get("response_type");
  const clientId = get("client_id");
  const codeChallenge = get("code_challenge");
  const codeChallengeMethod = get("code_challenge_method");
  const resource = get("resource");
  const scope = get("scope") || SCOPE;

  // redirect_uri must exactly match the single pre-registered SPA URI.
  const expectedRedirect = allowedRedirectUri(req);
  if (redirectUri !== expectedRedirect) {
    // Never redirect to an unregistered URI (open-redirect protection, spec §8.1).
    return new Response(
      `invalid redirect_uri.\nexpected: ${expectedRedirect}\ngot:      ${redirectUri}`,
      { status: 400, headers: { "Content-Type": "text/plain" } },
    );
  }

  const user = USERS[userKey];
  if (!user) return errorRedirect(redirectUri, state, "access_denied", "unknown user");
  if (responseType !== "code")
    return errorRedirect(redirectUri, state, "unsupported_response_type", "response_type must be code");
  if (clientId !== CLIENT_ID)
    return errorRedirect(redirectUri, state, "unauthorized_client", "unknown client_id");
  if (codeChallengeMethod !== "S256" || !codeChallenge)
    return errorRedirect(redirectUri, state, "invalid_request", "PKCE S256 required");

  const code = await createAuthCode({
    sub: user.sub,
    role: user.role,
    codeChallenge,
    codeChallengeMethod,
    redirectUri,
    resource: resource || resourceUrl(req),
    scope,
    clientId,
    state,
  });

  const u = new URL(redirectUri);
  u.searchParams.set("code", code);
  if (state) u.searchParams.set("state", state);
  return NextResponse.redirect(u.toString(), 302);
}
