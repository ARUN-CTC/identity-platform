import { lazy } from "react";

import { AuthLayout } from "@/app/layouts/AuthLayout";

import { PlatformShell } from "../layout/PlatformShell";
import PlatformDashboardPage from "../pages/PlatformDashboardPage";
import PlatformForbiddenPage from "../pages/PlatformForbiddenPage";
import PlatformLoginPage from "../pages/PlatformLoginPage";
import PlatformNotFoundPage from "../pages/PlatformNotFoundPage";
import { PLATFORM_PERMISSIONS } from "../permissions";
import { PlatformPermissionRoute, PlatformProtectedRoute } from "./PlatformRouteGuards";
import { PlatformRoot } from "./PlatformRoot";

const PlatformTenantsPage = lazy(() => import("../features/tenants/pages/PlatformTenantsPage"));
const PlatformTenantDetailPage = lazy(() => import("../features/tenants/pages/PlatformTenantDetailPage"));
const PlatformTenantEntitlementsPage = lazy(() => import("../features/tenants/pages/PlatformTenantEntitlementsPage"));
const PlatformTenantServiceAccountGrantsPage = lazy(() => import("../features/tenants/pages/PlatformTenantServiceAccountGrantsPage"));
const PlatformProductsPage = lazy(() => import("../features/products/pages/PlatformProductsPage"));
const PlatformProductDetailPage = lazy(() => import("../features/products/pages/PlatformProductDetailPage"));
const PlatformApplicationDetailPage = lazy(() => import("../features/applications/pages/PlatformApplicationDetailPage"));
const PlatformOperatorsPage = lazy(() => import("../features/operators/pages/PlatformOperatorsPage"));
const PlatformOperatorDetailPage = lazy(() => import("../features/operators/pages/PlatformOperatorDetailPage"));
const PlatformAuditPage = lazy(() => import("../features/audit/pages/PlatformAuditPage"));

/**
 * The entire Platform Operator Console route subtree — a top-level sibling
 * of the tenant app's own route tree (see app/router/routes.tsx), never
 * nested inside it, never sharing `AuthLayout`'s tenant branding beyond the
 * chrome-only wrapper, and never reachable through the tenant AppShell's
 * navigation. Every route below requires a genuine Platform Operator
 * access token — a tenant JWT, however broad, is rejected outright by the
 * backend (401), never merely denied a permission.
 */
export const platformConsoleRoutes = {
  element: <PlatformRoot />,
  children: [
    {
      element: <AuthLayout />,
      children: [{ path: "platform-console/login", element: <PlatformLoginPage /> }],
    },
    {
      element: <PlatformProtectedRoute />,
      children: [
        {
          element: <PlatformShell />,
          children: [
            { path: "platform-console", element: <PlatformDashboardPage /> },
            { path: "platform-console/403", element: <PlatformForbiddenPage /> },
            {
              path: "platform-console/tenants",
              element: (
                <PlatformPermissionRoute permission={PLATFORM_PERMISSIONS.PLATFORM_TENANT_VIEW}>
                  <PlatformTenantsPage />
                </PlatformPermissionRoute>
              ),
            },
            {
              path: "platform-console/tenants/:id",
              element: (
                <PlatformPermissionRoute permission={PLATFORM_PERMISSIONS.PLATFORM_TENANT_VIEW}>
                  <PlatformTenantDetailPage />
                </PlatformPermissionRoute>
              ),
            },
            {
              path: "platform-console/tenants/:id/entitlements",
              element: (
                <PlatformPermissionRoute permission={PLATFORM_PERMISSIONS.PRODUCT_ENTITLEMENT_VIEW}>
                  <PlatformTenantEntitlementsPage />
                </PlatformPermissionRoute>
              ),
            },
            {
              path: "platform-console/tenants/:id/service-account-grants",
              element: (
                <PlatformPermissionRoute permission={PLATFORM_PERMISSIONS.SERVICE_ACCOUNT_TENANT_GRANT_VIEW}>
                  <PlatformTenantServiceAccountGrantsPage />
                </PlatformPermissionRoute>
              ),
            },
            {
              path: "platform-console/products",
              element: (
                <PlatformPermissionRoute permission={PLATFORM_PERMISSIONS.PRODUCT_VIEW}>
                  <PlatformProductsPage />
                </PlatformPermissionRoute>
              ),
            },
            {
              path: "platform-console/products/:id",
              element: (
                <PlatformPermissionRoute permission={PLATFORM_PERMISSIONS.PRODUCT_VIEW}>
                  <PlatformProductDetailPage />
                </PlatformPermissionRoute>
              ),
            },
            {
              path: "platform-console/applications/:id",
              element: (
                <PlatformPermissionRoute permission={PLATFORM_PERMISSIONS.APPLICATION_VIEW}>
                  <PlatformApplicationDetailPage />
                </PlatformPermissionRoute>
              ),
            },
            {
              path: "platform-console/operators",
              element: (
                <PlatformPermissionRoute permission={PLATFORM_PERMISSIONS.PLATFORM_OPERATOR_VIEW}>
                  <PlatformOperatorsPage />
                </PlatformPermissionRoute>
              ),
            },
            {
              path: "platform-console/operators/:id",
              element: (
                <PlatformPermissionRoute permission={PLATFORM_PERMISSIONS.PLATFORM_OPERATOR_VIEW}>
                  <PlatformOperatorDetailPage />
                </PlatformPermissionRoute>
              ),
            },
            {
              path: "platform-console/audit",
              element: (
                <PlatformPermissionRoute permission={PLATFORM_PERMISSIONS.PLATFORM_SECURITY_VIEW}>
                  <PlatformAuditPage />
                </PlatformPermissionRoute>
              ),
            },
            { path: "platform-console/*", element: <PlatformNotFoundPage /> },
          ],
        },
      ],
    },
  ],
};
