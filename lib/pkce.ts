// PKCE (RFC 7636) S256 verification, used by the token endpoint.

function base64UrlEncode(bytes: Uint8Array): string {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Compute the S256 code_challenge for a given code_verifier. */
export async function s256Challenge(codeVerifier: string): Promise<string> {
  const data = new TextEncoder().encode(codeVerifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

/** Verify a code_verifier against a stored S256 code_challenge. */
export async function verifyPkceS256(
  codeVerifier: string,
  codeChallenge: string,
): Promise<boolean> {
  const computed = await s256Challenge(codeVerifier);
  // constant-time-ish compare
  if (computed.length !== codeChallenge.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ codeChallenge.charCodeAt(i);
  return diff === 0;
}
