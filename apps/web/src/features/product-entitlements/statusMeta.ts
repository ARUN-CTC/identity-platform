import type { StatusKey } from "@/design-system/tokens/status";
import type { EntitlementStatus } from "@/shared/api";

export interface EntitlementStatusMeta {
  statusKey: StatusKey;
  label: string;
}

// Mirrors the real entitlement status column (database/ddl/007_tenant_product_entitlement.sql)
// — ACTIVE | SUSPENDED | REVOKED, no PENDING. REVOKED maps to "rejected"
// (error tone) rather than "suspended" (warning tone) since — unlike a
// suspension — there is no path back to ACTIVE except a Platform Operator's
// explicit reactivate action (POST .../reactivate), not reachable from this
// tenant-scoped app at all (see shared/api/product-entitlements.ts).
const ENTITLEMENT_STATUS_META: Record<EntitlementStatus, EntitlementStatusMeta> = {
  ACTIVE: { statusKey: "active", label: "Active" },
  SUSPENDED: { statusKey: "suspended", label: "Suspended" },
  REVOKED: { statusKey: "rejected", label: "Revoked" },
};

export function getEntitlementStatusMeta(status: EntitlementStatus): EntitlementStatusMeta {
  return ENTITLEMENT_STATUS_META[status];
}
