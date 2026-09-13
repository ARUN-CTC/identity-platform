/**
 * Phase 2D.10 (docs/PRODUCT_INTEGRATION_CONTRACT.md §Authorization) —
 * stable, product-facing names for the Phase 2D.6 authorization seam
 * (`docs/RESOURCE_AUTHORIZATION_CONTRACT.md`). Every export here is an
 * alias of an existing, already-tested type — nothing in this file changes
 * `ResourceAuthorizationGuard`'s behavior, `ResourceAuthorizationPolicy`'s
 * contract, or `toResourceAuthorizationContext`'s conversion logic. See
 * `identity-principal.contract.ts` for why aliasing (not renaming) is the
 * deliberate choice.
 *
 * `IdentityAuthorizationContext` is what a product's own
 * `IdentityAuthorizationPolicy` implementation receives; `IdentityAuthorizationRequest`
 * names the opaque product/resource/action/scope/permission being asked
 * about; `IdentityAuthorizationResult` is the one typed answer a policy
 * must return. None of `productId`/`resource`/`action`/`requiredPermissions`
 * is ever interpreted by the Identity Platform — see
 * `docs/RESOURCE_AUTHORIZATION_CONTRACT.md` §4.
 */
export type {
  ResourceAuthorizationContext as IdentityAuthorizationContext,
} from '../modules/resource-server/interfaces';
export { toResourceAuthorizationContext as toIdentityAuthorizationContext } from '../modules/resource-server/interfaces';

export type {
  ResourceAuthorizationRequest as IdentityAuthorizationRequest,
  ResourceAuthorizationPolicy as IdentityAuthorizationPolicy,
  AuthorizationDecision as IdentityAuthorizationResult,
} from '../modules/resource-server/authorization';
export { denied as identityAuthorizationDenied } from '../modules/resource-server/authorization';
