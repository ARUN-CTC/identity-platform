import { ResourceAuthorizationContext } from '../../interfaces';
import { AuthorizationDecision } from './authorization-decision.interface';
import { ResourceAuthorizationRequest } from './resource-authorization-request.interface';

/**
 * Phase 2D.6 (docs/RESOURCE_AUTHORIZATION_CONTRACT.md §Authorization
 * provider contract) — the ONE contract a product implements to plug its
 * own IAM/entitlement/resource-ownership decision into the pipeline
 * `ResourceAuthorizationGuard` runs. The Identity Platform ships this
 * interface and the registry that looks implementations up by
 * `productId` — it ships NO implementation of this interface for any real
 * product (TravelOS or otherwise); `ResourceServerDemoController`'s own
 * test/support policies (registered only by this repo's own e2e suite) are
 * the only implementations that exist in this codebase, and they encode
 * nothing but generic, made-up demo rules.
 *
 * A policy MAY compose whatever additional checks it needs — including
 * this platform's own `ProductAccessService.canAccess()` (Phase 2B.2,
 * `TenantProductEntitlement`) if the product wants a live, per-request
 * entitlement check — but the Identity Platform's own generic guard never
 * calls that itself (brief §10: no automatic DB lookup per resource
 * request unless the product's own policy chooses to make one).
 */
export interface ResourceAuthorizationPolicy {
  authorize(context: ResourceAuthorizationContext, request: ResourceAuthorizationRequest): Promise<AuthorizationDecision>;
}
