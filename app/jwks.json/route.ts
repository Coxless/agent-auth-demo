// AS JWKS endpoint. The RS verifies token signatures against these public keys.
import { jsonResponse, corsPreflight } from "@/lib/http";
import { getJwks } from "@/lib/keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

export async function GET() {
  return jsonResponse(await getJwks());
}
