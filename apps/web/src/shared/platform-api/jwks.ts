/**
 * Phase 2UI.3 — `GET /.well-known/jwks.json` is a fully PUBLIC,
 * unauthenticated endpoint by design (any resource server must be able to
 * fetch it with no credential at all — docs/OAUTH_OPERATIONAL_HARDENING.md
 * §8) and lives OUTSIDE the versioned `/api/v1` prefix
 * (`app.setGlobalPrefix('api/v1', { exclude: ['.well-known/jwks.json', ...] })`,
 * src/main.ts). Deliberately NOT routed through `platformApiRequest` —
 * that client always prefixes `/api/v1` and always attaches a bearer
 * token, neither of which applies here. A plain, unauthenticated `fetch`
 * against the API's own origin (derived from the same `VITE_API_BASE_URL`
 * every other client uses, with the `/api/v1` suffix stripped) is the
 * correct, minimal implementation.
 */
export interface JsonWebKey {
  kty: string;
  use?: string;
  alg?: string;
  kid: string;
  n?: string;
  e?: string;
}

function apiOrigin(): string {
  const configured = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000/api/v1";
  return configured.replace(/\/api\/v1\/?$/, "");
}

export async function listSigningKeys(): Promise<JsonWebKey[]> {
  const res = await fetch(`${apiOrigin()}/.well-known/jwks.json`);
  if (!res.ok) {
    throw new Error(`JWKS endpoint returned ${res.status}`);
  }
  const body = (await res.json()) as { keys?: JsonWebKey[] };
  return body.keys ?? [];
}
