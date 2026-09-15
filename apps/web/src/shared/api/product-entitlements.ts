import { apiRequest } from "./client";

// Mirrors the real entitlement status column (database/ddl/007_tenant_product_entitlement.sql):
// ACTIVE | SUSPENDED | REVOKED. No PENDING — a new entitlement is created
// directly ACTIVE (see that DDL's own "Why no PENDING" comment).
export type EntitlementStatus = "ACTIVE" | "SUSPENDED" | "REVOKED";

/**
 * Mirrors `TenantProductEntitlementsService.listForCallersOwnTenant()`'s
 * exact response shape (src/modules/product-entitlements/services/tenant-product-entitlements.service.ts)
 * — NOT the raw `TenantProductEntitlement` row. `eligible` is
 * `ProductAccessService.canAccess()`'s own computed, deny-by-default
 * decision (Product.status takes precedence over entitlement status), so
 * this app never re-derives that logic itself.
 */
export interface MyProductEntitlement {
  productId: string;
  productName: string;
  productSlug: string;
  status: EntitlementStatus;
  eligible: boolean;
}

/**
 * ⚠ Read-only by design, not by omission.
 *
 * `GET /product-entitlements` (src/modules/product-entitlements/controllers/my-entitlements.controller.ts)
 * is the ONLY product-entitlement endpoint a tenant-scoped caller can ever
 * reach. Everything else — the full CRUD/lifecycle surface
 * (`POST/GET/PATCH /platform/tenants/:tenantId/product-entitlements[/:productId]`,
 * `.../reactivate`) and the Product catalog itself (`/products`) — requires
 * Platform Operator authentication (`PlatformJwtAuthGuard`/
 * `PlatformPermissionsGuard`, `PRODUCT_ENTITLEMENT_VIEW|MANAGE` and
 * `PRODUCT_VIEW|MANAGE`, both `platform_only = TRUE` in the permission
 * catalog — database/seeds/001_permissions.sql explicitly documents this as
 * "never a tenant's own self-service action", citing Security Invariant
 * #13: "a Tenant Admin cannot self-grant product entitlement"). There is no
 * tenant-permission path to grant, revoke, or even browse the product
 * catalog — not a gap, a deliberate boundary (see the Phase 2 Product
 * Entitlements verification report). This app therefore wraps only this
 * one call; there is intentionally no `grantEntitlement`/`revokeEntitlement`/
 * `listProducts` here, and none should be added without a Platform Operator
 * console — a separate authentication boundary this app does not implement
 * (see [[platform-operator-is-separate-auth-boundary]]).
 *
 * No tenantId parameter exists here on purpose: the backend derives it from
 * `RequestContextService.requireTenantId()` (JWT-sourced, server-side) —
 * never a client-supplied id — so there is nothing for this app to pass or
 * restrict itself. Unlike `shared/api/tenants.ts`'s `getOwnTenant`, this
 * endpoint's isolation is a real backend guarantee, not a frontend
 * convention.
 */
export function listMyProductEntitlements(): Promise<MyProductEntitlement[]> {
  return apiRequest<MyProductEntitlement[]>("/product-entitlements");
}
