/**
 * Phase 2D.9 (docs/OAUTH_OPERATIONAL_HARDENING.md §Resource consumption
 * limits, brief §5) — explicit, bounded maximum lengths for every
 * security-sensitive OAuth/OIDC input this platform accepts. Values are
 * deliberately generous (a genuine client's own `redirect_uri`/`state`/
 * `scope` value is always far shorter) — the point is to deterministically
 * REJECT a pathological, unbounded input, never to constrain a normal one.
 * Rejected inputs fail the SAME validation pipeline (`class-validator`'s
 * `@MaxLength`) every other DTO field violation already fails through —
 * never silently truncated (brief §5 — "do not silently truncate
 * security-sensitive values").
 */
export const OAUTH_INPUT_MAX_LENGTHS = {
  CLIENT_ID: 200,
  REDIRECT_URI: 2048,
  STATE: 512,
  NONCE: 512,
  SCOPE: 1024,
  AUDIENCE: 200,
  CODE_CHALLENGE: 128,
  CODE_CHALLENGE_METHOD: 16,
  RESPONSE_TYPE: 32,
  ORGANIZATION_ID: 64,
  AUTHORIZATION_CODE: 512,
  CODE_VERIFIER: 128,
  SERVICE_ACCOUNT_ID: 64,
  SERVICE_ACCOUNT_SECRET: 512,
  TENANT_ID: 64,
  GRANT_TYPE: 64,
} as const;

/** RFC 6750 bearer tokens are JWTs in this platform — three base64url segments; this bounds the RAW HEADER VALUE length before any parsing/regex is even attempted (brief §5 — "bearer token input size"). */
export const MAX_BEARER_TOKEN_LENGTH = 8192;
