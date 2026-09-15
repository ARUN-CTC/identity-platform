import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { LoadingState } from "@/design-system/components/LoadingState";
import { usePlatformAuth } from "../providers/PlatformAuthProvider";

/** Redirects to /platform-console/login (preserving the attempted location) when unauthenticated. */
export function PlatformProtectedRoute() {
  const { isAuthenticated, isLoading } = usePlatformAuth();
  const location = useLocation();

  if (isLoading) return <LoadingState label="Loading Platform Console…" />;
  if (!isAuthenticated) {
    return <Navigate to="/platform-console/login" replace state={{ from: location }} />;
  }
  return <Outlet />;
}

interface PlatformPermissionRouteProps {
  permission: string;
  children?: ReactNode;
}

/** Same shape as the tenant app's PermissionRoute — renders the 403 page in place rather than redirecting. */
export function PlatformPermissionRoute({ permission, children }: PlatformPermissionRouteProps) {
  const { hasPlatformPermission, isLoading } = usePlatformAuth();

  if (isLoading) return <LoadingState label="Checking platform permissions…" />;
  if (!hasPlatformPermission(permission)) {
    return <Navigate to="/platform-console/403" replace />;
  }
  return children ? <>{children}</> : <Outlet />;
}
