import { lazy } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";

import { AppShell } from "@/app/layouts/AppShell";
import { AuthLayout } from "@/app/layouts/AuthLayout";
import AcceptInvitationPage from "@/app/pages/AcceptInvitationPage";
import ChooseOrganizationPage from "@/app/pages/ChooseOrganizationPage";
import ForbiddenPage from "@/app/pages/ForbiddenPage";
import ForgotPasswordPage from "@/app/pages/ForgotPasswordPage";
import LoginPage from "@/app/pages/LoginPage";
import OAuthAuthorizeExpiredPage from "@/app/pages/oauth/OAuthAuthorizeExpiredPage";
import ResetPasswordPage from "@/app/pages/ResetPasswordPage";
import NotFoundPage from "@/app/pages/NotFoundPage";
import ServerErrorPage from "@/app/pages/ServerErrorPage";
import { PERMISSIONS } from "@/shared/auth/permissions";
import { platformConsoleRoutes } from "@/platform-console/router/platformRoutes";

import { PermissionRoute, ProtectedRoute } from "./route-guards";

const DashboardPage = lazy(() => import("@/app/pages/DashboardPage"));
const SettingsPage = lazy(() => import("@/app/pages/SettingsPage"));
const UsersPage = lazy(() => import("@/features/users/pages/UsersPage"));
const UserDetailsPage = lazy(() => import("@/features/users/pages/UserDetailsPage"));
const MembershipsPage = lazy(() => import("@/features/memberships/pages/MembershipsPage"));
const InvitationsPage = lazy(() => import("@/features/memberships/pages/InvitationsPage"));
const MySessionsPage = lazy(() => import("@/features/sessions/pages/MySessionsPage"));
const OrganizationsPage = lazy(() => import("@/features/organizations/pages/OrganizationsPage"));
const OrganizationDetailsPage = lazy(() => import("@/features/organizations/pages/OrganizationDetailsPage"));
const OrganizationTypesPage = lazy(() => import("@/features/organization-types/pages/OrganizationTypesPage"));
const RolesPage = lazy(() => import("@/features/roles/pages/RolesPage"));
const RoleDetailsPage = lazy(() => import("@/features/roles/pages/RoleDetailsPage"));
const PermissionsPage = lazy(() => import("@/features/permissions/pages/PermissionsPage"));
const SecurityAuditPage = lazy(() => import("@/features/security-audit/pages/SecurityAuditPage"));
const TenantSettingsPage = lazy(() => import("@/features/tenant-settings/pages/TenantSettingsPage"));
const ProductEntitlementsPage = lazy(() => import("@/features/product-entitlements/pages/ProductEntitlementsPage"));

/**
 * Route tree mirrors navigation.ts's paths and permissions 1:1 — if you add
 * a nav item with a `path`, add the matching <Route> here (and vice versa).
 * Every screen behind a permission gate below is a PlaceholderPage for now
 * (Phase 1 is scoped to the shell + P0 authentication only — see the Phase
 * 1 plan) — routing/permission wiring is real and validated end-to-end
 * ahead of each domain's own screens being built.
 */
export const router = createBrowserRouter([
  {
    element: <AuthLayout />,
    children: [
      { path: "/login", element: <LoginPage /> },
      { path: "/choose-organization", element: <ChooseOrganizationPage /> },
      { path: "/forgot-password", element: <ForgotPasswordPage /> },
      { path: "/reset-password", element: <ResetPasswordPage /> },
      { path: "/accept-invitation", element: <AcceptInvitationPage /> },
      { path: "/oauth/authorize/expired", element: <OAuthAuthorizeExpiredPage /> },
      { path: "/403", element: <ForbiddenPage /> },
      { path: "/500", element: <ServerErrorPage /> },
    ],
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate to="/dashboard" replace /> },
          { path: "dashboard", element: <DashboardPage /> },
          { path: "settings", element: <SettingsPage /> },
          // Self-service — no permission required beyond authentication,
          // same as TravelOS's own /iam/security (see navigation.ts's
          // comment on why this isn't an Administration/permission-gated item).
          { path: "my-sessions", element: <MySessionsPage /> },

          // Self-service, read-only — GET /product-entitlements needs nothing
          // beyond ordinary tenant authentication (no PRODUCT_ENTITLEMENT_VIEW
          // check; that permission is platform_only and could never be
          // granted to a tenant Role — see ProductEntitlementsPage's own doc
          // comment and navigation.ts's precedent for why this isn't gated).
          { path: "product-entitlements", element: <ProductEntitlementsPage /> },

          {
            path: "users",
            element: (
              <PermissionRoute permission={PERMISSIONS.USER_VIEW}>
                <UsersPage />
              </PermissionRoute>
            ),
          },
          {
            path: "users/:id",
            element: (
              <PermissionRoute permission={PERMISSIONS.USER_VIEW}>
                <UserDetailsPage />
              </PermissionRoute>
            ),
          },
          {
            path: "memberships",
            element: (
              <PermissionRoute permission={PERMISSIONS.USER_VIEW}>
                <MembershipsPage />
              </PermissionRoute>
            ),
          },
          {
            path: "invitations",
            element: (
              <PermissionRoute permission={PERMISSIONS.USER_VIEW}>
                <InvitationsPage />
              </PermissionRoute>
            ),
          },
          {
            path: "organizations",
            element: (
              <PermissionRoute permission={PERMISSIONS.ORGANIZATION_MANAGE}>
                <OrganizationsPage />
              </PermissionRoute>
            ),
          },
          {
            path: "organizations/:id",
            element: (
              <PermissionRoute permission={PERMISSIONS.ORGANIZATION_MANAGE}>
                <OrganizationDetailsPage />
              </PermissionRoute>
            ),
          },
          {
            path: "organization-types",
            element: (
              <PermissionRoute permission={PERMISSIONS.ORGANIZATION_MANAGE}>
                <OrganizationTypesPage />
              </PermissionRoute>
            ),
          },
          {
            path: "roles",
            element: (
              <PermissionRoute permission={PERMISSIONS.ROLE_VIEW}>
                <RolesPage />
              </PermissionRoute>
            ),
          },
          {
            path: "roles/:id",
            element: (
              <PermissionRoute permission={PERMISSIONS.ROLE_VIEW}>
                <RoleDetailsPage />
              </PermissionRoute>
            ),
          },
          {
            path: "permissions",
            element: (
              <PermissionRoute permission={PERMISSIONS.PERMISSION_VIEW}>
                <PermissionsPage />
              </PermissionRoute>
            ),
          },
          {
            path: "security/audit-events",
            element: (
              <PermissionRoute permission={PERMISSIONS.SECURITY_AUDIT_VIEW}>
                <SecurityAuditPage />
              </PermissionRoute>
            ),
          },
          {
            path: "tenant-settings",
            element: (
              <PermissionRoute permission={PERMISSIONS.TENANT_MANAGE}>
                <TenantSettingsPage />
              </PermissionRoute>
            ),
          },

          { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
  },
  platformConsoleRoutes,
  { path: "*", element: <NotFoundPage /> },
]);
