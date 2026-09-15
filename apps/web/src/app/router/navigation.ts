import AdminPanelSettingsOutlinedIcon from "@mui/icons-material/AdminPanelSettingsOutlined";
import ApartmentOutlinedIcon from "@mui/icons-material/ApartmentOutlined";
import CategoryOutlinedIcon from "@mui/icons-material/CategoryOutlined";
import DashboardOutlinedIcon from "@mui/icons-material/DashboardOutlined";
import DevicesOutlinedIcon from "@mui/icons-material/DevicesOutlined";
import ExtensionOutlinedIcon from "@mui/icons-material/ExtensionOutlined";
import GroupOutlinedIcon from "@mui/icons-material/GroupOutlined";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import ShieldOutlinedIcon from "@mui/icons-material/ShieldOutlined";
import TuneOutlinedIcon from "@mui/icons-material/TuneOutlined";
import VerifiedUserOutlinedIcon from "@mui/icons-material/VerifiedUserOutlined";

import { PERMISSIONS } from "@/shared/auth/permissions";
import type { NavigationSection } from "@/shared/types/navigation";

/**
 * Single source of truth for this app's own sidebar/mobile-nav tree and for
 * route generation (see routes.tsx). Never hard-code nav items inside
 * Sidebar — add/reorder here instead.
 *
 * This is the TENANT-scoped Identity Admin Console's navigation — Tenant
 * Administrator/Member self-service and tenant-level IAM administration
 * only. It deliberately does NOT include Applications, Service Accounts,
 * Products, or Platform Operators: every one of those is gated by a
 * `platform_only = TRUE` permission (database/seeds/001_permissions.sql)
 * that can never be granted to a tenant Role and so can never appear in
 * this app's own `GET /auth/me` response — including them here would be
 * exactly the permanently-dead, invisible-to-everyone nav entry TravelOS's
 * own history explicitly removed (see that project's navigation.ts, the
 * old `GROUP_VIEW`-gated "IAM Groups" item). Platform Administration is a
 * separate security boundary with its own login (see
 * src/modules/platform-operators/) and belongs in a separate Platform
 * Operator console shell, not this tenant sidebar — see
 * shared/auth/useRoleContext.ts's own doc comment for the full reasoning.
 *
 * Every item gating access to real functionality uses `PERMISSIONS.*` from
 * the centralized registry (shared/auth/permissions.ts) — never a raw
 * string literal — so a typo fails to compile instead of silently hiding a
 * menu item.
 *
 * "Sessions" is deliberately NOT under Administration, gated on
 * SESSION_MANAGE — that permission exists in the catalog
 * (database/seeds/001_permissions.sql) but is checked by nothing (grep
 * confirms zero references in src/); there is no admin endpoint to list or
 * revoke another user's sessions at all (see
 * src/modules/sessions/controllers/sessions.controller.ts — every route
 * reads the caller's own identity from the JWT). Putting it there would
 * have been exactly the permanently-dead nav item this file's header
 * comment already calls out as an anti-pattern to avoid. The real,
 * self-service session list (`GET /sessions/me`) is "My Sessions" below —
 * always visible, like Settings, since it needs no permission beyond
 * being signed in.
 *
 * Same reasoning for "Product Entitlements" below: `PRODUCT_ENTITLEMENT_VIEW`/
 * `PRODUCT_ENTITLEMENT_MANAGE`/`PRODUCT_VIEW`/`PRODUCT_MANAGE` are all
 * `platform_only = TRUE` and gate only the Platform-Operator-only
 * CRUD/lifecycle surface and the product catalog itself — never grantable
 * to a tenant Role, so never usable to gate a tenant-sidebar item. The real
 * tenant-facing endpoint (`GET /product-entitlements`, read-only,
 * self-service) needs nothing beyond being signed in, same as My Sessions.
 */
export const navigationSections: NavigationSection[] = [
  {
    id: "root",
    items: [
      {
        id: "dashboard",
        label: "Dashboard",
        path: "/dashboard",
        icon: DashboardOutlinedIcon,
        order: 0,
      },
    ],
  },
  {
    id: "administration",
    label: "Administration",
    items: [
      {
        id: "administration",
        label: "Administration",
        icon: ShieldOutlinedIcon,
        anyOfPermissions: [
          PERMISSIONS.USER_VIEW,
          PERMISSIONS.ROLE_VIEW,
          PERMISSIONS.PERMISSION_VIEW,
          PERMISSIONS.ORGANIZATION_MANAGE,
          PERMISSIONS.SECURITY_AUDIT_VIEW,
          PERMISSIONS.TENANT_MANAGE,
        ],
        order: 10,
        children: [
          { id: "users", label: "Users", path: "/users", icon: GroupOutlinedIcon, permission: PERMISSIONS.USER_VIEW },
          {
            id: "organizations",
            label: "Organizations",
            path: "/organizations",
            icon: ApartmentOutlinedIcon,
            permission: PERMISSIONS.ORGANIZATION_MANAGE,
          },
          {
            id: "organization-types",
            label: "Organization Types",
            path: "/organization-types",
            icon: CategoryOutlinedIcon,
            permission: PERMISSIONS.ORGANIZATION_MANAGE,
          },
          {
            id: "roles",
            label: "Roles & Permissions",
            path: "/roles",
            icon: AdminPanelSettingsOutlinedIcon,
            permission: PERMISSIONS.ROLE_VIEW,
          },
          {
            id: "permissions",
            label: "Permission Catalog",
            path: "/permissions",
            icon: VerifiedUserOutlinedIcon,
            permission: PERMISSIONS.PERMISSION_VIEW,
          },
          {
            id: "security-audit",
            label: "Security & Audit",
            path: "/security/audit-events",
            icon: HistoryOutlinedIcon,
            permission: PERMISSIONS.SECURITY_AUDIT_VIEW,
          },
          {
            id: "tenant-settings",
            label: "Tenant Settings",
            path: "/tenant-settings",
            icon: TuneOutlinedIcon,
            permission: PERMISSIONS.TENANT_MANAGE,
          },
        ],
      },
    ],
  },
  {
    id: "settings",
    items: [
      {
        id: "my-sessions",
        label: "My Sessions",
        path: "/my-sessions",
        icon: DevicesOutlinedIcon,
        order: 55,
      },
      {
        id: "product-entitlements",
        label: "Product Entitlements",
        path: "/product-entitlements",
        icon: ExtensionOutlinedIcon,
        order: 57,
      },
      {
        id: "settings",
        label: "Settings",
        path: "/settings",
        icon: SettingsOutlinedIcon,
        order: 60,
      },
    ],
  },
];

/** Flattened, order-sorted, top-level items — handy for tests/breadcrumb lookups. */
export function flattenNavigation(sections: NavigationSection[] = navigationSections) {
  const items = sections.flatMap((section) => section.items);
  return [...items].sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
}
