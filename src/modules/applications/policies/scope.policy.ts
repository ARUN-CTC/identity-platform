import { HttpStatus, Injectable } from '@nestjs/common';
import { Application } from '@prisma/client';
import { AppException } from '../../../common';

/**
 * Phase 2D.2 (docs/TOKEN_AND_SCOPE_ARCHITECTURE.md §5) — the only scopes not
 * subject to a Product's own namespace: the three OIDC standard scopes.
 * Every other scope must be namespaced under the registering Application's
 * own Product slug (`<product-slug>.<verb>`) — the exact namespace-ownership
 * rule ADR-004 already established for IAM permission codes, applied here
 * to OAuth scopes for the same reason (a product cannot register, or be
 * granted, a scope implying another product's capability).
 */
const STANDARD_OIDC_SCOPES = ['openid', 'profile', 'email'];

/**
 * Phase 2D.2 — reusable, fail-closed scope policy. OAuth scope is never
 * conflated with IAM permission here or anywhere else (docs/APPLICATION_AUTHORIZATION.md
 * §1) — this class only ever answers "may this Application request this
 * scope string," never "may the resulting principal actually do X."
 */
@Injectable()
export class ApplicationScopePolicy {
  /**
   * Registration/update-time: every scope an Application is configured to
   * be ALLOWED to request must be a standard OIDC scope or namespaced under
   * its own Product's slug — never another product's namespace, never an
   * un-namespaced free-form string.
   */
  validateScopesForRegistration(productSlug: string, scopes: string[]): void {
    const ownNamespace = `${productSlug.toLowerCase()}.`;
    for (const scope of scopes) {
      if (!scope) {
        throw new AppException('INVALID_APPLICATION_CONFIGURATION', 'allowedScopes must not contain an empty entry', HttpStatus.BAD_REQUEST);
      }
      if (STANDARD_OIDC_SCOPES.includes(scope)) {
        continue;
      }
      if (!scope.toLowerCase().startsWith(ownNamespace)) {
        throw new AppException(
          'INVALID_SCOPE_NAMESPACE',
          `Scope '${scope}' is not a standard OIDC scope (${STANDARD_OIDC_SCOPES.join(', ')}) and is not namespaced under this application's own product ('${ownNamespace}*')`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }
    if (new Set(scopes).size !== scopes.length) {
      throw new AppException('INVALID_APPLICATION_CONFIGURATION', 'allowedScopes must not contain duplicate entries', HttpStatus.BAD_REQUEST);
    }
  }

  /**
   * Runtime (future `/token`/`/authorize`): fail-closed subset check —
   * `requestedScopes ⊆ application.allowedScopes`. Never silently expands
   * or narrows the requested set; the caller (a future endpoint) is
   * expected to reject the whole request on `false`, not drop the
   * unauthorized scopes and proceed with the rest.
   */
  validateRequestedScopes(application: Pick<Application, 'allowedScopes'>, requestedScopes: string[]): boolean {
    return requestedScopes.every((scope) => application.allowedScopes.includes(scope));
  }
}
