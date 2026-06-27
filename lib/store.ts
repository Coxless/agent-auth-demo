// In-memory stores for authorization codes and demo records.
//
// NOTE: this is intentionally ephemeral (spec §9: "インメモリ or KV"). State is
// lost on server restart and is not shared across serverless instances. That is
// acceptable for a single-process learning demo; see README for the limitation.

import { randomBytes } from "crypto";

export interface AuthCode {
  sub: string;
  role: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  redirectUri: string;
  resource: string;
  scope: string;
  clientId: string;
  state?: string;
  expiresAt: number; // epoch ms
}

export interface RecordItem {
  id: string;
  data: unknown;
  updatedAt: string;
}

interface Stores {
  authCodes: Map<string, AuthCode>;
  records: Map<string, RecordItem>;
}

declare global {
  // eslint-disable-next-line no-var
  var __demo_stores__: Stores | undefined;
}

function stores(): Stores {
  if (!globalThis.__demo_stores__) {
    const records = new Map<string, RecordItem>();
    const now = new Date().toISOString();
    records.set("r1", { id: "r1", data: { title: "Hello record", note: "seed data" }, updatedAt: now });
    records.set("r2", { id: "r2", data: { title: "Second record", note: "seed data" }, updatedAt: now });
    globalThis.__demo_stores__ = { authCodes: new Map(), records };
  }
  return globalThis.__demo_stores__;
}

const CODE_TTL_MS = 60_000; // authorization codes are short-lived

export function createAuthCode(input: Omit<AuthCode, "expiresAt">): string {
  const code = randomBytes(24).toString("base64url");
  stores().authCodes.set(code, { ...input, expiresAt: Date.now() + CODE_TTL_MS });
  return code;
}

/** One-time consume: returns the code record and deletes it (null if missing/expired). */
export function consumeAuthCode(code: string): AuthCode | null {
  const s = stores();
  const found = s.authCodes.get(code);
  if (!found) return null;
  s.authCodes.delete(code);
  if (Date.now() > found.expiresAt) return null;
  return found;
}

// --- Record CRUD (the MCP tools operate on these) ---

export function readRecord(id: string): RecordItem | null {
  return stores().records.get(id) ?? null;
}

export function writeRecord(id: string, data: unknown): RecordItem {
  const item: RecordItem = { id, data, updatedAt: new Date().toISOString() };
  stores().records.set(id, item);
  return item;
}

export function deleteRecord(id: string): boolean {
  return stores().records.delete(id);
}

export function listRecordIds(): string[] {
  return [...stores().records.keys()];
}
