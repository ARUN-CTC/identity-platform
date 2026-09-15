import { ForbiddenException } from '@nestjs/common';
import { AuthenticatedExternalPrincipal } from '../interfaces';

/**
 * Phase 2D.5 (brief §17) — the validation contract for a product that
 * accepts an explicit tenant request parameter/header IN ADDITION TO the
 * cryptographically validated token: the requested value must exactly
 * match `principal.tenantId` (the token's own, server-validated tenant) or
 * the request is denied outright. Never resolves a mismatch by preferring
 * one source over the other, and never silently substitutes the token's
 * own tenant for a differing caller-supplied one — a mismatch is itself
 * the signal to deny (a caller attempting to override tenant context via a
 * header/param, e.g. `X-Tenant-Id`, is exactly the "tenant header
 * spoofing" attack this function exists to close).
 *
 * Deliberately a plain `ForbiddenException`, not a `ResourceServerAuthError`
 * — a tenant-parameter mismatch is a PRODUCT-layer authorization decision
 * (brief §19), not an RFC 6750 Bearer-token-validity failure; the token
 * itself is perfectly valid, the caller is just asking to act outside what
 * it authenticates for.
 */
export function assertRequestedTenantMatches(principal: AuthenticatedExternalPrincipal, requestedTenantId: string | undefined): void {
  if (requestedTenantId !== undefined && requestedTenantId !== principal.tenantId) {
    throw new ForbiddenException('The requested tenant does not match the authenticated token');
  }
}
