import { AuthenticatedExternalPrincipal } from './authenticated-external-principal.interface';

/**
 * Phase 2D.5 — the safe, generic context a downstream guard/service/product
 * can use to make ITS OWN authorization decision. Deliberately flat and
 * inert: every field is copied straight from the verified
 * `AuthenticatedExternalPrincipal` (never re-derived, never expanded with
 * anything a database lookup would need to produce) — this is a
 * convenience view over the principal, not a second source of truth.
 *
 * Contains NO product-specific IAM permission logic and NO Product-
 * entitlement decision — per `docs/RESOURCE_SERVER_ARCHITECTURE.md` §19,
 * that composition belongs to whichever future phase/product actually
 * builds it (`ProductAccessService`, IAM permission checks, etc.), never
 * centralized here.
 */
export interface ResourceAuthorizationContext {
  readonly principal: AuthenticatedExternalPrincipal;
  readonly tenantId: string;
  readonly audience: string;
  readonly scopes: string[];
  readonly subject: string;
  readonly clientId: string;
  /** Mirrors `principal.serviceAccountId` — `undefined` unless `principal.type === 'SERVICE_ACCOUNT'`. */
  readonly serviceAccountId?: string;
  /** Phase 2D.7 — mirrors `principal.userId` — `undefined` unless `principal.type === 'USER'`. */
  readonly userId?: string;
  /** Phase 2D.7 — mirrors `principal.organizationId`. `undefined` for a SERVICE_ACCOUNT principal; `null`/a string for a USER principal (tenant-wide vs. a selected organization). */
  readonly organizationId?: string | null;
  /** Phase 2D.6 — the token's own unique id, mirrored at the top level (matching this phase's own suggested context shape) for correlation/logging without a second hop through `.principal`. Always equal to `principal.jti`. */
  readonly jti: string;
}

export function toResourceAuthorizationContext(principal: AuthenticatedExternalPrincipal): ResourceAuthorizationContext {
  return {
    principal,
    tenantId: principal.tenantId,
    audience: principal.audience,
    scopes: principal.scopes,
    subject: principal.subject,
    clientId: principal.clientId,
    serviceAccountId: principal.serviceAccountId,
    userId: principal.userId,
    organizationId: principal.organizationId,
    jti: principal.jti,
  };
}
