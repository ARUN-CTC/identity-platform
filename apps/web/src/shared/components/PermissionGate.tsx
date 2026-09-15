import type { ReactNode } from "react";

import { usePermissionContext } from "@/app/providers/PermissionProvider";
import type { Permission } from "@/shared/types/permission";

export interface PermissionGateProps {
  /** Single permission to require. Ignored if `anyOf`/`allOf` is provided. */
  permission?: Permission;
  /** Render if the user has at least one of these permissions. */
  anyOf?: Permission[];
  /** Render if the user has every one of these permissions. */
  allOf?: Permission[];
  /** Rendered when the check fails. Omit to render nothing (the common case). */
  fallback?: ReactNode;
  children: ReactNode;
}

/**
 * UX-only gate — hides/shows children based on the real, backend-resolved
 * permission set from `/auth/me`. This is never the security boundary; the
 * backend must reject unauthorized requests independently.
 */
export function PermissionGate({ permission, anyOf, allOf, fallback = null, children }: PermissionGateProps) {
  const { hasPermission, hasAnyPermission, hasAllPermissions } = usePermissionContext();

  let allowed = true;
  if (allOf) allowed = allowed && hasAllPermissions(allOf);
  if (anyOf) allowed = allowed && hasAnyPermission(anyOf);
  if (permission) allowed = allowed && hasPermission(permission);

  return <>{allowed ? children : fallback}</>;
}

/** Terse alias — `<Can permission="...">`. */
export const Can = PermissionGate;
