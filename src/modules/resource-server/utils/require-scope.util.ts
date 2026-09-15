import { ResourceServerAuthError } from '../errors';
import { AuthenticatedExternalPrincipal } from '../interfaces';

/**
 * Phase 2D.5/2D.6 — the reusable, product-neutral scope-evaluation helpers.
 * Never invoked automatically by `ExternalBearerAuthGuard` itself (scope
 * policy is the product's own decision, brief §16/§19) — these are
 * plumbing a route/policy MAY call, demonstrated on `ResourceServerDemoController`
 * and exercised directly by their own unit tests.
 *
 * Matching discipline (Phase 2D.6 brief §13), applied by every function
 * here: EXACT string equality only — never a prefix/suffix/substring match,
 * never case-insensitive, never wildcard, never an implicit elevation from
 * one scope to a "broader" one. `'documents.read'` does not satisfy a
 * requirement for `'documents.read.anything'` or `'documents.readwrite'`,
 * and vice versa. An absent or empty scope set means "no scopes granted" —
 * never "all scopes."
 */

/** Exact-match membership check — the primitive every other function here is built from. */
export function hasScope(principal: Pick<AuthenticatedExternalPrincipal, 'scopes'>, scope: string): boolean {
  return principal.scopes.includes(scope);
}

/** Throws unless `scope` is present, exactly. */
export function requireScope(principal: Pick<AuthenticatedExternalPrincipal, 'scopes'>, requiredScope: string): void {
  if (!hasScope(principal, requiredScope)) {
    throw new ResourceServerAuthError('insufficient_scope', 'insufficient_scope', 'The access token does not grant a required scope');
  }
}

/**
 * AND semantics, explicit: every scope in `requiredScopes` must be present.
 * `requireScopes(p, [])` never throws (an empty requirement is trivially
 * satisfied) — the caller asked for nothing.
 */
export function requireScopes(principal: Pick<AuthenticatedExternalPrincipal, 'scopes'>, requiredScopes: string[]): void {
  const missing = requiredScopes.filter((s) => !hasScope(principal, s));
  if (missing.length > 0) {
    throw new ResourceServerAuthError('insufficient_scope', 'insufficient_scope', 'The access token does not grant a required scope');
  }
}

/**
 * OR semantics, explicit and separate from `requireScopes` (brief §14 —
 * "if OR semantics are required later, expose a separate explicit API...
 * do not make AND/OR semantics implicit"): at least one of `anyOfScopes`
 * must be present. `requireAnyScope(p, [])` always throws — an empty
 * "any of" list can never be satisfied (there is nothing to have any of).
 */
export function requireAnyScope(principal: Pick<AuthenticatedExternalPrincipal, 'scopes'>, anyOfScopes: string[]): void {
  if (anyOfScopes.length === 0 || !anyOfScopes.some((s) => hasScope(principal, s))) {
    throw new ResourceServerAuthError('insufficient_scope', 'insufficient_scope', 'The access token does not grant a required scope');
  }
}
