import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useAuth } from "@/app/providers/AuthProvider";
import { usePermissionContext } from "@/app/providers/PermissionProvider";
import { LoadingState } from "@/design-system/components/LoadingState";
import type { Permission } from "@/shared/types/permission";

/**
 * Redirects to /login (preserving the attempted location) when unauthenticated.
 * Renders an <Outlet /> so it can wrap a whole route subtree in routes.tsx.
 */
export function ProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return <LoadingState label="Loading Identity Platform…" />;
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <Outlet />;
}

interface PermissionRouteProps {
  permission: Permission;
  children?: ReactNode;
}

/**
 * Renders the 403 page in place instead of redirecting, so the user keeps
 * their URL/back-button context. Used per-route in routes.tsx, e.g.
 * <Route element={<PermissionRoute permission="USER_VIEW" />}>.
 *
 * Waits for permission resolution (a real backend round-trip, see
 * PermissionProvider) before deciding — otherwise every gated route would
 * flash 403 on first render before permissions have loaded.
 */
export function PermissionRoute({ permission, children }: PermissionRouteProps) {
  const { hasPermission, isLoading } = usePermissionContext();

  if (isLoading) return <LoadingState label="Checking permissions…" />;
  if (!hasPermission(permission)) {
    return <Navigate to="/403" replace />;
  }
  return children ? <>{children}</> : <Outlet />;
}
