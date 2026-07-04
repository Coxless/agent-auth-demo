// In-memory store for demo records.
//
// NOTE: this is intentionally ephemeral (spec §9: "インメモリ or KV"). Record
// writes are lost on server restart and are not shared across serverless
// instances — acceptable for this learning demo; see README for the limitation.
// (Authorization codes used to live here too, but are now stateless signed JWTs;
// see lib/authcode.ts.)

export interface RecordItem {
  id: string;
  data: unknown;
  updatedAt: string;
}

interface Stores {
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
    globalThis.__demo_stores__ = { records };
  }
  return globalThis.__demo_stores__;
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

export function listRecords(): RecordItem[] {
  return [...stores().records.values()].sort((a, b) => a.id.localeCompare(b.id));
}
