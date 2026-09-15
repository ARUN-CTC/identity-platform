import type { StatusKey } from "@/design-system/tokens/status";
import type { TenantStatus } from "@/shared/platform-api";

export interface TenantStatusMeta {
  statusKey: StatusKey;
  label: string;
}

const TENANT_STATUS_META: Record<TenantStatus, TenantStatusMeta> = {
  PROVISIONING: { statusKey: "pending", label: "Provisioning" },
  ACTIVE: { statusKey: "active", label: "Active" },
  SUSPENDED: { statusKey: "suspended", label: "Suspended" },
};

export function getTenantStatusMeta(status: TenantStatus): TenantStatusMeta {
  return TENANT_STATUS_META[status];
}
