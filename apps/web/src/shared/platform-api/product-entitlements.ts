import { platformApiRequest } from "./client";

export type EntitlementStatus = "ACTIVE" | "SUSPENDED" | "REVOKED";

export interface PlatformTenantEntitlement {
  id: string;
  tenantId: string;
  productId: string;
  status: EntitlementStatus;
  createdAt: string;
  updatedAt?: string | null;
  /** Joined product summary (TenantProductEntitlementsRepository.listForTenant's own include). */
  product?: { id: string; name: string; slug: string; status: string };
}

// Mirrors update-entitlement-status.dto.ts — REVOKED is reachable from
// ACTIVE/SUSPENDED via this generic PATCH, but REVOKED -> ACTIVE is NOT;
// use reactivatePlatformEntitlement for that (the one, deliberate, distinct path out of REVOKED).
export type PatchableEntitlementStatus = "ACTIVE" | "SUSPENDED" | "REVOKED";

const base = (tenantId: string) => `/platform/tenants/${tenantId}/product-entitlements`;

/** Gated on PRODUCT_ENTITLEMENT_VIEW. */
export function listTenantEntitlements(tenantId: string): Promise<PlatformTenantEntitlement[]> {
  return platformApiRequest<PlatformTenantEntitlement[]>(base(tenantId));
}

/** Gated on PRODUCT_ENTITLEMENT_MANAGE. Created ACTIVE. 409 if this tenant already has an entitlement record for this product. */
export function createTenantEntitlement(tenantId: string, productId: string): Promise<PlatformTenantEntitlement> {
  return platformApiRequest<PlatformTenantEntitlement>(base(tenantId), { method: "POST", body: { productId } });
}

/** 409 ENTITLEMENT_ALREADY_IN_STATUS or INVALID_ENTITLEMENT_TRANSITION if the transition isn't allowed from the current status. */
export function updateTenantEntitlementStatus(tenantId: string, productId: string, status: PatchableEntitlementStatus): Promise<PlatformTenantEntitlement> {
  return platformApiRequest<PlatformTenantEntitlement>(`${base(tenantId)}/${productId}`, { method: "PATCH", body: { status } });
}

/** The only path from REVOKED back to ACTIVE. 409 if current status isn't REVOKED. */
export function reactivateTenantEntitlement(tenantId: string, productId: string): Promise<PlatformTenantEntitlement> {
  return platformApiRequest<PlatformTenantEntitlement>(`${base(tenantId)}/${productId}/reactivate`, { method: "POST" });
}
