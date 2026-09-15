/**
 * A single public RSA key in JWKS (RFC 7517) form — deliberately only the
 * fields a public-key JWK can ever have. `n`/`e` come from calling Node's own
 * `crypto.createPublicKey(pem).export({ format: 'jwk' })` on a KeyObject
 * that was itself constructed from a PUBLIC key PEM — such a KeyObject has
 * no private material loaded into it at all, so private fields (`d`, `p`,
 * `q`, `dp`, `dq`, `qi`) are structurally absent, not merely omitted by
 * convention (docs/KEY_MANAGEMENT_ARCHITECTURE.md §3).
 */
export interface Jwk {
  kty: 'RSA';
  use: 'sig';
  alg: 'RS256';
  kid: string;
  n: string;
  e: string;
}

export interface JwksResponse {
  keys: Jwk[];
}
