import ApartmentOutlinedIcon from "@mui/icons-material/ApartmentOutlined";
import DashboardOutlinedIcon from "@mui/icons-material/DashboardOutlined";
import ExtensionOutlinedIcon from "@mui/icons-material/ExtensionOutlined";
import GroupOutlinedIcon from "@mui/icons-material/GroupOutlined";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import KeyOutlinedIcon from "@mui/icons-material/KeyOutlined";
import LinkOutlinedIcon from "@mui/icons-material/LinkOutlined";
import MailOutlineIcon from "@mui/icons-material/MailOutline";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import ShieldOutlinedIcon from "@mui/icons-material/ShieldOutlined";
import SmartToyOutlinedIcon from "@mui/icons-material/SmartToyOutlined";
import type { SvgIconComponent } from "@mui/icons-material";

import { PLATFORM_PERMISSIONS } from "./permissions";

export interface PlatformNavItem {
  id: string;
  label: string;
  path: string;
  icon: SvgIconComponent;
  /** Omit for an always-visible item (needs nothing beyond being an authenticated operator). */
  permission?: string;
  /** Phase 2UI.3 — this item routes to a documented API-gap page (see docs/PHASE_2UI3.md), not a real data view yet. Used only to render a small visual cue; never hides the item. */
  apiGap?: boolean;
}

export interface PlatformNavSection {
  /** Omit for an unlabeled top-level section (Dashboard). */
  label?: string;
  items: PlatformNavItem[];
}

/**
 * The Platform Console's own nav — separate from, and never merged with,
 * the tenant Identity Admin Console's `app/router/navigation.ts`. Every
 * item's `permission` is a genuinely platform_only code, verified enforced
 * server-side. Grouped into sections per docs/IDENTITY_ADMIN_INFORMATION_ARCHITECTURE.md's
 * corrected target IA (Phase 2UI.1) — refined further this phase (2UI.3)
 * against what's actually buildable: Applications/Service Accounts stay as
 * top-level entries (matching the target IA) but route to a documented
 * gap page today, since no cross-product/cross-application list endpoint
 * exists yet — see docs/PHASE_2UI3.md's own API Gap table for exactly why.
 */
export const platformNavigation: PlatformNavSection[] = [
  {
    items: [{ id: "dashboard", label: "Dashboard", path: "/platform-console", icon: DashboardOutlinedIcon }],
  },
  {
    label: "Identity",
    items: [
      { id: "users", label: "Users", path: "/platform-console/users", icon: GroupOutlinedIcon, apiGap: true },
      { id: "memberships", label: "Memberships", path: "/platform-console/memberships", icon: LinkOutlinedIcon, apiGap: true },
      { id: "invitations", label: "Invitations", path: "/platform-console/invitations", icon: MailOutlineIcon, apiGap: true },
    ],
  },
  {
    label: "Tenancy",
    items: [{ id: "tenants", label: "Tenants", path: "/platform-console/tenants", icon: ApartmentOutlinedIcon, permission: PLATFORM_PERMISSIONS.PLATFORM_TENANT_VIEW }],
  },
  {
    label: "Products",
    items: [{ id: "products", label: "Products", path: "/platform-console/products", icon: ExtensionOutlinedIcon, permission: PLATFORM_PERMISSIONS.PRODUCT_VIEW }],
  },
  {
    label: "Applications",
    items: [{ id: "applications", label: "Applications", path: "/platform-console/applications", icon: KeyOutlinedIcon, permission: PLATFORM_PERMISSIONS.APPLICATION_VIEW, apiGap: true }],
  },
  {
    label: "Service Accounts",
    items: [{ id: "service-accounts", label: "Service Accounts", path: "/platform-console/service-accounts", icon: SmartToyOutlinedIcon, permission: PLATFORM_PERMISSIONS.SERVICE_ACCOUNT_VIEW, apiGap: true }],
  },
  {
    label: "Security",
    items: [{ id: "audit", label: "Platform Audit", path: "/platform-console/audit", icon: HistoryOutlinedIcon, permission: PLATFORM_PERMISSIONS.PLATFORM_SECURITY_VIEW }],
  },
  {
    label: "Platform",
    items: [
      { id: "operators", label: "Platform Operators", path: "/platform-console/operators", icon: ShieldOutlinedIcon, permission: PLATFORM_PERMISSIONS.PLATFORM_OPERATOR_VIEW },
      { id: "signing-keys", label: "Signing Keys", path: "/platform-console/signing-keys", icon: KeyOutlinedIcon },
      { id: "configuration", label: "Configuration", path: "/platform-console/configuration", icon: SettingsOutlinedIcon, apiGap: true },
    ],
  },
];
