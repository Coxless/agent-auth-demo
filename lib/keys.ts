// AS signing key management. The AS signs access tokens with an RS256 private
// key and publishes the matching public key as a JWKS. In this single-process
// demo the RS verifies against that same JWKS (see lib/jwt.ts). In a real
// multi-origin deployment the RS would fetch the AS JWKS over HTTP instead.
//
// A key can be supplied via env (SIGNING_PRIVATE_KEY = private JWK JSON,
// SIGNING_KID). Otherwise an ephemeral RS256 key is generated once per process
// and cached on globalThis so it survives Next.js dev hot-reloads.

import {
  generateKeyPair,
  exportJWK,
  importJWK,
  type JWK,
  type CryptoKey,
  type KeyObject,
} from "jose";

type SigningKey = CryptoKey | KeyObject;

export interface SigningMaterial {
  kid: string;
  alg: "RS256";
  privateKey: SigningKey;
  publicJwk: JWK; // includes kid, alg, use:"sig"
}

const ALG = "RS256" as const;

declare global {
  // eslint-disable-next-line no-var
  var __as_signing_material__: Promise<SigningMaterial> | undefined;
}

async function build(): Promise<SigningMaterial> {
  const envPrivate = process.env.SIGNING_PRIVATE_KEY;
  if (envPrivate) {
    const jwk = JSON.parse(envPrivate) as JWK;
    const kid = process.env.SIGNING_KID || jwk.kid || "as-key-1";
    const privateKey = (await importJWK({ ...jwk, alg: ALG }, ALG)) as SigningKey;
    // Derive the public JWK from the supplied private JWK directly. We cannot
    // re-export from `privateKey` because importJWK produces a non-extractable
    // CryptoKey (signing-only), and exportJWK on it throws.
    const publicJwk: JWK = { kty: jwk.kty, n: jwk.n, e: jwk.e, kid, alg: ALG, use: "sig" };
    return { kid, alg: ALG, privateKey, publicJwk };
  }

  const { privateKey } = await generateKeyPair(ALG, { extractable: true });
  const kid = process.env.SIGNING_KID || "as-dev-key-1";
  const pub = await exportJWK(privateKey);
  // exportJWK on a private key includes private params; re-derive the public set.
  const publicJwk: JWK = {
    kty: pub.kty,
    n: pub.n,
    e: pub.e,
    kid,
    alg: ALG,
    use: "sig",
  };
  return { kid, alg: ALG, privateKey, publicJwk };
}

export function getSigningMaterial(): Promise<SigningMaterial> {
  if (!globalThis.__as_signing_material__) {
    globalThis.__as_signing_material__ = build();
  }
  return globalThis.__as_signing_material__;
}

export async function getJwks(): Promise<{ keys: JWK[] }> {
  const { publicJwk } = await getSigningMaterial();
  return { keys: [publicJwk] };
}
