/**
 * Phase 2D.5 (brief §7) — extracts a bearer token from a raw
 * `Authorization` header value. Returns `null` for anything not a single,
 * well-formed `Bearer <token>` header — the caller (`ExternalBearerAuthGuard`)
 * turns every `null` into the identical, generic `invalid_token`/
 * `invalid_request` response; this function itself never throws and never
 * returns a distinguishing reason (that distinction is for internal logging
 * only, via the guard's own reason codes).
 *
 * Deliberately independent of `JwtAuthGuard.readBearerToken()` (the legacy,
 * internal HS256 path, `src/modules/authentication/guards/jwt-auth.guard.ts`)
 * — same shape of problem, but this function is stricter (rejects a
 * header-splitting ambiguity the legacy path was never hardened against,
 * since the legacy guard is only ever reached via this platform's own
 * first-party clients) and belongs to a structurally separate trust
 * boundary (docs/EXTERNAL_API_TRUST_BOUNDARY.md §0) — not reused across
 * that boundary on purpose.
 */
const BEARER_TOKEN_PATTERN = /^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/;

// Phase 2D.9 (docs/OAUTH_OPERATIONAL_HARDENING.md §Resource consumption
// limits, brief §5 — "bearer token input size") — rejected BEFORE the
// pattern match even runs, so a pathologically large header value is
// never handed to the regex engine at all.
const MAX_HEADER_LENGTH = 8192;

export function extractBearerToken(authorizationHeader: string | string[] | undefined): string | null {
  if (authorizationHeader === undefined) {
    return null;
  }
  if (!Array.isArray(authorizationHeader) && authorizationHeader.length > MAX_HEADER_LENGTH) {
    return null;
  }

  // Node collapses a genuinely duplicated `Authorization` header into a
  // single comma-joined string (or, in some proxy/test configurations, an
  // array) — either shape is ambiguous and must be rejected outright, never
  // resolved by "just take the first one."
  if (Array.isArray(authorizationHeader)) {
    return null;
  }
  if (authorizationHeader.includes(',')) {
    return null;
  }

  const header = authorizationHeader.trim();
  if (!header) {
    return null;
  }

  const spaceIndex = header.indexOf(' ');
  if (spaceIndex < 0) {
    return null; // "Bearer" alone, or any schemeless value
  }

  const scheme = header.slice(0, spaceIndex);
  if (scheme !== 'Bearer') {
    return null; // Basic/Digest/anything else — never scheme-negotiated
  }

  const token = header.slice(spaceIndex + 1).trim();
  if (!token) {
    return null; // "Bearer " / "Bearer   " with nothing after it
  }

  // A minimal shape check at the extraction layer itself (brief's own
  // "malformed bearer syntax" reject case) — three non-empty,
  // base64url-alphabet dot-separated segments. Full cryptographic/claim
  // validation happens downstream; this only screens out values that could
  // never possibly be a JWT at all.
  if (!BEARER_TOKEN_PATTERN.test(token)) {
    return null;
  }

  return token;
}
