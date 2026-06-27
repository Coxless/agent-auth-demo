// Central configuration for the three OAuth roles co-hosted in this single app.
// Everything is derived from the incoming request origin by default so the demo
// works unchanged on localhost and on a deployed origin. Env vars can override.

export const SCOPE = "mcp:tools";
export const CLIENT_ID = process.env.CLIENT_ID || "agent-auth-demo-spa";
export const ACCESS_TOKEN_TTL_SECONDS = 600; // 10 minutes (short-lived, spec §11.2)

export type Role = "admin" | "editor" | "viewer";

export interface DemoUser {
  sub: string;
  role: Role;
  label: string;
  description: string;
}

// Three fictional users (no PII), spec §5.
export const USERS: Record<string, DemoUser> = {
  alice: { sub: "alice", role: "admin", label: "alice", description: "admin — 全操作可能" },
  bob: { sub: "bob", role: "editor", label: "bob", description: "editor — 読み書き可・削除不可" },
  carol: { sub: "carol", role: "viewer", label: "carol", description: "viewer — 読み取りのみ" },
};

/** Origin (scheme://host[:port]) of the current request, honoring proxy headers. */
export function originFromRequest(req: Request): string {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || url.host;
  const proto = req.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

/** The AS issuer identifier (RFC 8414). Defaults to the request origin. */
export function issuer(req: Request): string {
  return process.env.AS_ISSUER || originFromRequest(req);
}

/** The protected resource / token audience (RFC 8707): the MCP endpoint URL. */
export function resourceUrl(req: Request): string {
  return process.env.RESOURCE_URL || `${originFromRequest(req)}/mcp`;
}

/** The single pre-registered SPA redirect URI (the app root handles the callback). */
export function allowedRedirectUri(req: Request): string {
  return process.env.SPA_REDIRECT_URI || `${originFromRequest(req)}/`;
}

export function jwksUri(req: Request): string {
  return `${issuer(req)}/jwks.json`;
}

export function asMetadataUrl(req: Request): string {
  return `${issuer(req)}/.well-known/oauth-authorization-server`;
}

export function prmUrl(req: Request): string {
  return `${originFromRequest(req)}/.well-known/oauth-protected-resource`;
}
