// Read-only view of the demo "database" (the in-memory record store that the
// MCP tools operate on). Used by the DB viewer panel in the UI so learners can
// watch how authorized tool calls mutate server state in real time.
//
// This is intentionally unauthenticated: it exposes only the demo records and
// is meant purely for observability in the learning UI. The *mutations* still
// go exclusively through the OAuth-protected, Cedar-authorized MCP endpoint.

import { listRecords } from "@/lib/store";
import { CORS_HEADERS } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const records = listRecords();
  return new Response(
    JSON.stringify({ records, count: records.length, fetchedAt: new Date().toISOString() }),
    {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS_HEADERS },
    },
  );
}
