import type { StatusKey } from "@/design-system/tokens/status";
import type { UserStatus } from "@/shared/api";

export interface UserStatusMeta {
  statusKey: StatusKey;
  label: string;
}

// Mirrors the real state machine in src/modules/users/services/users.service.ts
// (LIFECYCLE_TRANSITIONS): PROVISIONED -> ACTIVE <-> SUSPENDED -> DEACTIVATED.
const USER_STATUS_META: Record<UserStatus, UserStatusMeta> = {
  PROVISIONED: { statusKey: "pending", label: "Invited" },
  ACTIVE: { statusKey: "active", label: "Active" },
  SUSPENDED: { statusKey: "suspended", label: "Suspended" },
  DEACTIVATED: { statusKey: "inactive", label: "Deactivated" },
};

export function getUserStatusMeta(status: UserStatus): UserStatusMeta {
  return USER_STATUS_META[status];
}
