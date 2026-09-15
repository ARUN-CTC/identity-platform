import { SetMetadata } from '@nestjs/common';

export const REQUIRE_RESOURCE_AUTHORIZATION_KEY = 'require_resource_authorization';

/**
 * Phase 2D.6 — declares a route's authorization REQUIREMENT, read by
 * `ResourceAuthorizationGuard` via `Reflector` (the same `SetMetadata`+
 * `Reflector` idiom `@ExpectedAudience`/`@RequirePlatformPermissions`
 * already establish). Describes the requirement only — `productId`/
 * `resource`/`action` are opaque strings the Identity Platform never
 * interprets; no TravelOS/Healthcare/Gym-specific value is ever named here
 * by this repository's own shipped code (brief §21: "the metadata should
 * describe the authorization requirement, not contain product-specific
 * knowledge").
 *
 * Mandatory on any route also carrying `ResourceAuthorizationGuard`: a
 * route with the guard but no metadata is a configuration error the guard
 * refuses to silently default around (fails closed with 500, mirroring
 * `@ExpectedAudience`'s own missing-metadata behavior).
 */
export interface RequireResourceAuthorizationOptions {
  readonly productId: string;
  readonly resource: string;
  readonly action: string;
  /** Enforced directly by the guard (Layer 5), before the registered policy is ever consulted — AND semantics (`requireScopes`). */
  readonly requiredScopes?: string[];
  /** Passed through to the policy as `ResourceAuthorizationRequest.requiredPermissions` — never evaluated by the guard itself (Layer 6 is product-owned). */
  readonly requiredPermissions?: string[];
}

export const RequireResourceAuthorization = (options: RequireResourceAuthorizationOptions) => SetMetadata(REQUIRE_RESOURCE_AUTHORIZATION_KEY, options);
