/**
 * Phase 2D.10 (docs/PRODUCT_INTEGRATION_CONTRACT.md §Entitlement) — the
 * stable, product-facing name for the Phase 2B.2 `TenantProductEntitlement`
 * decision (`ProductAccessService.canAccess()`). Unlike
 * `identity-principal.contract.ts`/`identity-authorization.contract.ts`,
 * this one is a TYPE-ONLY alias — `ProductAccessService` itself is an
 * Identity-Platform-internal, database-backed NestJS provider that only
 * ever runs INSIDE this platform's own process (it queries `Product` and
 * `TenantProductEntitlement` directly). A genuinely separate product
 * process (TravelOS, or any future product, per the absolute repository
 * isolation rule — `docs/PHASE_2D10.md` §Isolation) cannot import this
 * class, and this contract does not pretend otherwise.
 *
 * What a separate-process product CAN rely on is the SHAPE of the
 * decision (`ProductEntitlementDecision`/`ProductEntitlementDenialReason`)
 * — useful today for the Identity Platform's own in-process demo/contract
 * tests (`tests/phase2d10-product-integration-contract.e2e-spec.ts`), and
 * documented as the shape any future live, product-callable entitlement
 * check (`docs/PRODUCT_INTEGRATION_CONTRACT.md` §Entitlement — a FUTURE
 * ARCHITECTURAL SEAM, not built this phase) would return.
 */
export type { ProductAccessDecision as ProductEntitlementDecision, ProductAccessDenialReason as ProductEntitlementDenialReason } from '../modules/product-entitlements/services';
