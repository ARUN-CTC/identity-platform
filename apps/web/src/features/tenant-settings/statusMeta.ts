import type { StatusKey } from "@/design-system/tokens/status";
import type { TenantStatus } from "@/shared/api";

export interface TenantStatusMeta {
  statusKey: StatusKey;
  label: string;
}

// Mirrors the real Tenant.status values (database/prisma/schema/tenant.prisma)
// and their only two transition endpoints (POST /tenants/:id/activate,
// POST /tenants/:id/suspend — see TenantsService, neither of which applies
// any current-status validation). Not editable from this page at all; see
// TenantSettingsPage's own doc comment for why.
const TENANT_STATUS_META: Record<TenantStatus, TenantStatusMeta> = {
  PROVISIONING: { statusKey: "pending", label: "Provisioning" },
  ACTIVE: { statusKey: "active", label: "Active" },
  SUSPENDED: { statusKey: "suspended", label: "Suspended" },
};

export function getTenantStatusMeta(status: TenantStatus): TenantStatusMeta {
  return TENANT_STATUS_META[status];
}
