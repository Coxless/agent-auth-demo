// Browser-side OAuth 2.1 public client (Authorization Code + PKCE) plus the MCP
// discovery sequence (401 -> PRM -> AS metadata). All steps emit log entries so
// the SPA can visualize the "芋づる式" discovery (spec §4).

export const CLIENT_ID = process.env.NEXT_PUBLIC_CLIENT_ID || "agent-auth-demo-spa";
export const SCOPE = "mcp:tools";

export type LogStatus = "info" | "ok" | "err";
export type LogFn = (step: string, status: LogStatus, detail?: unknown) => void;

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomString(bytes = 32): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return b64url(a);
}

async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

export interface DiscoveryResult {
  prm: { resource: string; authorization_servers: string[]; scopes_supported?: string[] };
  as: {
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
    jwks_uri: string;
  };
  resource: string;
}

const PENDING_KEY = "oauth_pending";

/** Parse the resource_metadata URL out of a WWW-Authenticate header. */
function parseResourceMetadata(header: string | null): string | null {
  if (!header) return null;
  const m = header.match(/resource_metadata="([^"]+)"/);
  return m ? m[1] : null;
}

/**
 * Discovery: probe /mcp without a token, follow the 401 -> PRM -> AS metadata
 * chain. Returns the endpoints needed for the authorization request.
 */
export async function discover(mcpUrl: string, log: LogFn): Promise<DiscoveryResult> {
  // 1. unauthenticated probe -> 401 + WWW-Authenticate
  log("1. /mcp をトークン無しで POST", "info");
  const probe = await fetch(mcpUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  });
  const wwwAuth = probe.headers.get("WWW-Authenticate");
  log(`   → ${probe.status} ${probe.statusText}`, probe.status === 401 ? "ok" : "err", {
    "WWW-Authenticate": wwwAuth,
  });
  let prmUrl = parseResourceMetadata(wwwAuth);
  if (!prmUrl) {
    prmUrl = new URL("/.well-known/oauth-protected-resource", mcpUrl).toString();
    log("   resource_metadata 未提示。既定パスにフォールバック", "info", prmUrl);
  }

  // 2. PRM (RFC 9728)
  log("2. PRM 取得 (RFC 9728)", "info", prmUrl);
  const prm = await (await fetch(prmUrl)).json();
  log("   → PRM", "ok", prm);
  const asBase = prm.authorization_servers?.[0];
  if (!asBase) throw new Error("PRM に authorization_servers がありません");

  // 3. AS metadata (RFC 8414)
  const asMetaUrl = new URL("/.well-known/oauth-authorization-server", asBase).toString();
  log("3. AS メタデータ取得 (RFC 8414)", "info", asMetaUrl);
  const as = await (await fetch(asMetaUrl)).json();
  log("   → AS metadata", "ok", as);

  return { prm, as, resource: prm.resource };
}

/** Build the PKCE authorization request and redirect the browser to the AS. */
export async function beginLogin(disc: DiscoveryResult, log: LogFn): Promise<void> {
  const codeVerifier = randomString(32);
  const codeChallenge = await s256(codeVerifier);
  const state = randomString(16);
  const redirectUri = window.location.origin + "/";

  sessionStorage.setItem(
    PENDING_KEY,
    JSON.stringify({
      codeVerifier,
      state,
      redirectUri,
      tokenEndpoint: disc.as.token_endpoint,
      resource: disc.resource,
    }),
  );

  const u = new URL(disc.as.authorization_endpoint);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", CLIENT_ID);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("code_challenge", codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("resource", disc.resource);
  u.searchParams.set("scope", SCOPE);
  u.searchParams.set("state", state);

  log("4. /authorize へリダイレクト (PKCE S256)", "info", {
    authorization_endpoint: disc.as.authorization_endpoint,
    resource: disc.resource,
    scope: SCOPE,
  });
  window.location.assign(u.toString());
}

export interface TokenResult {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

/**
 * On callback (URL has ?code), exchange the code for a token. Returns null if
 * there is no pending login / no code in the URL.
 */
export async function completeLoginIfCallback(log: LogFn): Promise<TokenResult | null> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  if (error) {
    log("認可エラー", "err", { error, description: url.searchParams.get("error_description") });
    cleanUrl();
    return null;
  }
  if (!code) return null;

  const raw = sessionStorage.getItem(PENDING_KEY);
  if (!raw) {
    log("pending state が見つかりません", "err");
    cleanUrl();
    return null;
  }
  const pending = JSON.parse(raw);
  const returnedState = url.searchParams.get("state");
  if (returnedState !== pending.state) {
    log("state 不一致 (CSRF 防止)", "err", { expected: pending.state, got: returnedState });
    cleanUrl();
    return null;
  }

  log("5. /token でコード交換 (code + code_verifier)", "info", pending.tokenEndpoint);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    code_verifier: pending.codeVerifier,
    redirect_uri: pending.redirectUri,
    client_id: CLIENT_ID,
  });
  const res = await fetch(pending.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json();
  sessionStorage.removeItem(PENDING_KEY);
  cleanUrl();
  if (!res.ok) {
    log("   → token error", "err", json);
    return null;
  }
  log("   → access_token 受領 (ロール入り JWT)", "ok", {
    token_type: json.token_type,
    expires_in: json.expires_in,
    scope: json.scope,
  });
  return json as TokenResult;
}

function cleanUrl() {
  const u = new URL(window.location.href);
  u.search = "";
  window.history.replaceState({}, "", u.toString());
}

/** Decode a JWT payload for display only (no verification). */
export function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    const part = token.split(".")[1];
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(decodeURIComponent(escape(json)));
  } catch {
    return null;
  }
}
