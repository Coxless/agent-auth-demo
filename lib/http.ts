// Small helpers for JSON responses with permissive CORS. In this single-origin
// demo CORS is largely unnecessary, but the metadata / token / JWKS endpoints
// advertise CORS to honor the spec's intent (§8.1, §8.2) and to keep the design
// portable to a real multi-origin deployment.

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": process.env.SPA_ORIGIN || "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...CORS_HEADERS,
      ...(init.headers || {}),
    },
  });
}

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export { CORS_HEADERS };
