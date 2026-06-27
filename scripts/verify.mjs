#!/usr/bin/env node
// Automated acceptance test for the demo (spec §14). Runs the full OAuth+MCP+Cedar
// flow against a running server for alice/bob/carol and checks the authz matrix,
// audience binding, and discovery endpoints.
//
// Usage: BASE_URL=http://localhost:3000 node scripts/verify.mjs

import { createHash, randomBytes } from "node:crypto";

const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const REDIRECT = BASE + "/";
const RESOURCE = BASE + "/mcp";
const CLIENT_ID = process.env.CLIENT_ID || "agent-auth-demo-spa";
const SCOPE = "mcp:tools";

let pass = 0;
let fail = 0;
function check(name, ok, extra = "") {
  const tag = ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
  console.log(`  [${tag}] ${name}${extra ? "  — " + extra : ""}`);
  ok ? pass++ : fail++;
}

function b64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function pkce() {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

async function getToken(user, resource = RESOURCE) {
  const { verifier, challenge } = pkce();
  const state = b64url(randomBytes(8));

  const authBody = new URLSearchParams({
    user,
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource,
    scope: SCOPE,
    state,
  });
  const authRes = await fetch(`${BASE}/api/authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: authBody,
    redirect: "manual",
  });
  const loc = authRes.headers.get("location");
  if (!loc) throw new Error(`no redirect from /api/authorize (status ${authRes.status})`);
  const code = new URL(loc).searchParams.get("code");
  if (!code) throw new Error(`no code in redirect: ${loc}`);

  const tokRes = await fetch(`${BASE}/api/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT,
      client_id: CLIENT_ID,
    }),
  });
  const tok = await tokRes.json();
  if (!tokRes.ok) throw new Error(`token error: ${JSON.stringify(tok)}`);
  return tok.access_token;
}

let mcpId = 1;
async function mcp(token, method, params) {
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: mcpId++, method, params }),
  });
  return res;
}

async function callTool(token, name, args) {
  const res = await mcp(token, "tools/call", { name, arguments: args });
  const json = await res.json().catch(() => null);
  const isError = json?.result?.isError === true;
  return { status: res.status, isError, json };
}

async function main() {
  console.log(`\nVerifying demo at ${BASE}\n`);

  // #1 / #10: discovery
  console.log("Discovery & unauthenticated probe:");
  const probe = await mcp(null, "initialize", {});
  const www = probe.headers.get("www-authenticate") || "";
  check("#1 /mcp without token => 401", probe.status === 401, `status=${probe.status}`);
  check("#1 WWW-Authenticate has resource_metadata", /resource_metadata=/.test(www), www);

  const prm = await (await fetch(`${BASE}/.well-known/oauth-protected-resource`)).json();
  check("#10 PRM has authorization_servers", Array.isArray(prm.authorization_servers) && prm.authorization_servers.length > 0);
  const asMeta = await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json();
  check("#10 AS metadata has token_endpoint + jwks_uri", !!asMeta.token_endpoint && !!asMeta.jwks_uri);
  check("#10 AS supports PKCE S256", (asMeta.code_challenge_methods_supported || []).includes("S256"));

  // Authz matrix per user
  const matrix = {
    alice: { read: "allow", write: "allow", delete: "allow" }, // admin (#2,#3)
    bob: { read: "allow", write: "allow", delete: "deny" }, // editor (#4,#5)
    carol: { read: "allow", write: "deny", delete: "deny" }, // viewer (#6,#7)
  };

  for (const [user, expect] of Object.entries(matrix)) {
    console.log(`\nUser ${user}:`);
    const token = await getToken(user);
    const r = await callTool(token, "readRecord", { id: "r1" });
    check(`${user} readRecord => ${expect.read}`, (r.isError ? "deny" : "allow") === expect.read, `isError=${r.isError}`);
    const w = await callTool(token, "writeRecord", { id: "r1", data: { k: "v" } });
    check(`${user} writeRecord => ${expect.write}`, (w.isError ? "deny" : "allow") === expect.write, `isError=${w.isError}`);
    const d = await callTool(token, "deleteRecord", { id: "r2" });
    check(`${user} deleteRecord => ${expect.delete}`, (d.isError ? "deny" : "allow") === expect.delete, `isError=${d.isError}`);
  }

  // #8: audience mismatch — mint a token bound to a different resource, expect 401.
  console.log("\nAudience binding:");
  const wrongAudToken = await getToken("alice", "https://evil.example/mcp");
  const audRes = await mcp(wrongAudToken, "tools/call", { name: "readRecord", arguments: { id: "r1" } });
  check("#8 aud-mismatch token => 401", audRes.status === 401, `status=${audRes.status}`);

  // #9: expired token — not automatable without waiting; noted as manual.
  console.log("\n#9 expired token: manual (TTL is 10m; reuse a token after expiry).");

  console.log(`\nResult: ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("verify crashed:", e);
  process.exit(1);
});
