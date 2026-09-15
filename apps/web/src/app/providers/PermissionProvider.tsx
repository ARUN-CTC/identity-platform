import { createContext, useContext, useMemo, type ReactNode } from "react";

import type { Permission } from "@/shared/types/permission";

import { useAuth } from "./AuthProvider";

interface PermissionContextValue {
  grantedPermissions: Set<Permission>;
  hasPermission: (permission: Permission) => boolean;
  hasAnyPermission: (permissions: Permission[]) => boolean;
  hasAllPermissions: (permissions: Permission[]) => boolean;
  /** True while AuthProvider is still bootstrapping (session restore + the `/auth/me` fetch it triggers). */
  isLoading: boolean;
}

const PermissionContext = createContext<PermissionContextValue | null>(null);

/**
 * Consumes AuthProvider's `/auth/me`-sourced `permissions` array directly —
 * there is no query of its own. `GET /auth/me` returns pre-resolved
 * permission codes in the same round trip AuthProvider already makes after
 * login/session-restore, so by the time this provider renders with
 * `isLoading: false`, permissions are already settled — no separate loading
 * state, no separate fetch, no separate failure mode to handle here.
 */
export function PermissionProvider({ children }: { children: ReactNode }) {
  const { permissions, isAuthenticated, isLoading: authLoading } = useAuth();

  const value = useMemo<PermissionContextValue>(() => {
    const grants = new Set<Permission>(isAuthenticated ? permissions : []);
    const hasPermission = (permission: Permission) => grants.has(permission);
    return {
      grantedPermissions: grants,
      hasPermission,
      hasAnyPermission: (perms) => perms.some(hasPermission),
      hasAllPermissions: (perms) => perms.every(hasPermission),
      isLoading: authLoading,
    };
  }, [permissions, isAuthenticated, authLoading]);

  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
}

export function usePermissionContext(): PermissionContextValue {
  const context = useContext(PermissionContext);
  if (!context) {
    throw new Error("usePermissionContext must be used within a PermissionProvider");
  }
  return context;
}

/**
 * Test-only seam: supplies a fixed permission set synchronously, bypassing
 * AuthProvider entirely. Lets PermissionGate/PermissionRoute unit tests
 * exercise their own consumption logic (allowed/denied/loading) without
 * mocking a full auth bootstrap. Never imported outside test files.
 */
export function TestPermissionProvider({
  children,
  grantedPermissions,
  isLoading = false,
}: {
  children: ReactNode;
  grantedPermissions: Permission[];
  isLoading?: boolean;
}) {
  const value = useMemo<PermissionContextValue>(() => {
    const grants = new Set<Permission>(grantedPermissions);
    const hasPermission = (permission: Permission) => grants.has(permission);
    return {
      grantedPermissions: grants,
      hasPermission,
      hasAnyPermission: (permissions) => permissions.some(hasPermission),
      hasAllPermissions: (permissions) => permissions.every(hasPermission),
      isLoading,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- grantedPermissions is a fresh array per test render by design
  }, [grantedPermissions.join(","), isLoading]);

  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
}
