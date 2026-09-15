import type { StatusKey } from "@/design-system/tokens/status";
import type { MembershipStatus, OrganizationStatus } from "@/shared/api";

export interface StatusMeta {
  statusKey: StatusKey;
  label: string;
}

// Mirrors src/modules/organizations/dto/update-organization.dto.ts exactly
// — only ACTIVE|INACTIVE exist. Do not add SUSPENDED/REVOKED here; they
// are not real backend values for Organization.status.
const ORGANIZATION_STATUS_META: Record<OrganizationStatus, StatusMeta> = {
  ACTIVE: { statusKey: "active", label: "Active" },
  INACTIVE: { statusKey: "inactive", label: "Inactive" },
};

export function getOrganizationStatusMeta(status: OrganizationStatus): StatusMeta {
  return ORGANIZATION_STATUS_META[status];
}

// Mirrors src/modules/memberships/dto/membership-status.ts's full
// MembershipStatus (INVITED -> ACTIVE <-> SUSPENDED -> REMOVED).
const MEMBERSHIP_STATUS_META: Record<MembershipStatus, StatusMeta> = {
  INVITED: { statusKey: "pending", label: "Invited" },
  ACTIVE: { statusKey: "active", label: "Active" },
  SUSPENDED: { statusKey: "suspended", label: "Suspended" },
  REMOVED: { statusKey: "inactive", label: "Removed" },
};

export function getMembershipStatusMeta(status: MembershipStatus): StatusMeta {
  return MEMBERSHIP_STATUS_META[status];
}
