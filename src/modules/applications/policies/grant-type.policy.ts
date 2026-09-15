import { HttpStatus, Injectable } from '@nestjs/common';
import { Application } from '@prisma/client';
import { AppException } from '../../../common';

/**
 * Phase 2D.2 (docs/adr/ADR-013-oauth-authorization-server.md §Decision,
 * docs/OAUTH_ARCHITECTURE.md) — the only grant types this platform's
 * approved architecture supports. `implicit`, `password` (resource-owner
 * password credentials), `device_authorization`, and `token_exchange` are
 * deliberately absent — OAuth 2.1 excludes the first two outright, and the
 * latter two have no approving ADR (ADR-021 explicitly defers
 * token_exchange). Anything not in this list is rejected, not merely
 * "unimplemented."
 */
export type GrantType = 'authorization_code' | 'client_credentials';
export const GRANT_TYPES: GrantType[] = ['authorization_code', 'client_credentials'];

/**
 * Phase 2D.2 — reusable, fail-closed grant-type policy for an `Application`.
 * `isGrantTypeAllowed` is the exact rule a future `/token` implementation
 * must use (docs/PHASE_2D_ARCHITECTURE.md §Implementation Roadmap, 2D.4/2D.9)
 * — written here, once, so that implementation and this phase's own
 * registration-time validation can never silently diverge.
 */
@Injectable()
export class ApplicationGrantPolicy {
  /**
   * An Application with an empty (or not-yet-configured) `grantTypes` list
   * is authorized for NO grant type — deny-by-default, the same posture
   * every other allow-list in this schema already takes (Membership,
   * TenantProductEntitlement).
   */
  isGrantTypeAllowed(application: Pick<Application, 'grantTypes'>, requestedGrantType: string): boolean {
    return application.grantTypes.includes(requestedGrantType);
  }

  /**
   * Registration/update-time validation — called by `ApplicationsService`,
   * never by a client request path. Rejects any grant type outside
   * `GRANT_TYPES` (defense in depth beyond the DTO's own allow-list),
   * duplicate entries, and the one client-type/grant-type combination that
   * can never be made to work: a PUBLIC client (no client secret — it
   * cannot authenticate itself) requesting `client_credentials`, which
   * RFC 6749 §4.4 requires client authentication for.
   */
  validateGrantTypesForRegistration(clientType: string, grantTypes: string[]): void {
    for (const grantType of grantTypes) {
      if (!GRANT_TYPES.includes(grantType as GrantType)) {
        throw new AppException('INVALID_GRANT_TYPE', `Unsupported grant type: '${grantType}'`, HttpStatus.BAD_REQUEST);
      }
    }
    if (new Set(grantTypes).size !== grantTypes.length) {
      throw new AppException('INVALID_APPLICATION_CONFIGURATION', 'grantTypes must not contain duplicate entries', HttpStatus.BAD_REQUEST);
    }
    if (clientType === 'PUBLIC' && grantTypes.includes('client_credentials')) {
      throw new AppException(
        'INVALID_APPLICATION_CONFIGURATION',
        'A PUBLIC client cannot be configured for the client_credentials grant — it has no client secret to authenticate itself with',
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
