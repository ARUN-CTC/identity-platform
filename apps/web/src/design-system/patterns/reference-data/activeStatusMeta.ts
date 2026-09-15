import type { StatusKey } from "@/design-system/tokens/status";

/** Shared by any reference-data entity that uses a plain `isActive: boolean` — no PROVISIONING/TRIAL-style lifecycle like Tenants/Organizations. */
export function getActiveStatusMeta(isActive: boolean): { statusKey: StatusKey; label: string } {
  return isActive ? { statusKey: "active", label: "Active" } : { statusKey: "inactive", label: "Inactive" };
}
