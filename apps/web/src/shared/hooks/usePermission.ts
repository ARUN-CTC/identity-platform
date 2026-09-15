import { usePermissionContext } from "@/app/providers/PermissionProvider";
import type { Permission } from "@/shared/types/permission";

/** Checks a single permission. */
export function usePermission(permission: Permission): boolean {
  const { hasPermission } = usePermissionContext();
  return hasPermission(permission);
}

/** Checks a list of permissions; `mode="all"` requires every one (default "any"). */
export function usePermissions(permissions: Permission[], mode: "any" | "all" = "any"): boolean {
  const { hasAnyPermission, hasAllPermissions } = usePermissionContext();
  return mode === "all" ? hasAllPermissions(permissions) : hasAnyPermission(permissions);
}
