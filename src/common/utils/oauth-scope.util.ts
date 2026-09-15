/**
 * Phase 2D.4/2D.5 — OAuth scope string parsing (RFC 6749 §3.3: space-
 * delimited, case-sensitive, no defined meaning to this platform beyond
 * "an opaque string the client/resource negotiate"). Shared by
 * `ClientCredentialsService` (parsing a token REQUEST's `scope` parameter,
 * Phase 2D.4) and `ExternalAccessTokenValidator` (parsing an issued
 * token's own `scope` CLAIM, Phase 2D.5) — one implementation, never two
 * that could drift apart on what counts as a valid delimiter.
 *
 * Deliberately splits on whitespace only — never accepts a comma-separated
 * list as an undocumented extension (both phases' own briefs are explicit
 * about this).
 */
export function parseScopeClaim(scope: string | undefined | null): string[] {
  if (!scope) {
    return [];
  }
  return scope.split(/\s+/).filter((s) => s.length > 0);
}
