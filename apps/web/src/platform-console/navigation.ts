import ApartmentOutlinedIcon from "@mui/icons-material/ApartmentOutlined";
import DashboardOutlinedIcon from "@mui/icons-material/DashboardOutlined";
import ExtensionOutlinedIcon from "@mui/icons-material/ExtensionOutlined";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import ShieldOutlinedIcon from "@mui/icons-material/ShieldOutlined";
import type { SvgIconComponent } from "@mui/icons-material";

import { PLATFORM_PERMISSIONS } from "./permissions";

export interface PlatformNavItem {
  id: string;
  label: string;
  path: string;
  icon: SvgIconComponent;
  /** Omit for an always-visible item (needs nothing beyond being an authenticated operator). */
  permission?: string;
}

/**
 * The Platform Console's own nav — separate from, and never merged with,
 * the tenant Identity Admin Console's `app/router/navigation.ts`. Every
 * item here uses a genuinely platform_only permission, verified enforced
 * server-side (see each module's own contract map from Phase 2 discovery),
 * never a tenant-grantable one.
 */
export const platformNavigation: PlatformNavItem[] = [
  { id: "dashboard", label: "Dashboard", path: "/platform-console", icon: DashboardOutlinedIcon },
  { id: "tenants", label: "Tenant Registry", path: "/platform-console/tenants", icon: ApartmentOutlinedIcon, permission: PLATFORM_PERMISSIONS.PLATFORM_TENANT_VIEW },
  { id: "products", label: "Products", path: "/platform-console/products", icon: ExtensionOutlinedIcon, permission: PLATFORM_PERMISSIONS.PRODUCT_VIEW },
  { id: "operators", label: "Platform Operators", path: "/platform-console/operators", icon: ShieldOutlinedIcon, permission: PLATFORM_PERMISSIONS.PLATFORM_OPERATOR_VIEW },
  { id: "audit", label: "Platform Audit", path: "/platform-console/audit", icon: HistoryOutlinedIcon, permission: PLATFORM_PERMISSIONS.PLATFORM_SECURITY_VIEW },
];
