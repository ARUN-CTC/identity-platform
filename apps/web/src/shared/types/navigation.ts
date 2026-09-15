import type { ComponentType } from "react";

import type { Permission } from "./permission";

export interface NavigationItem {
  /** Stable identifier — also used as the React key, must be unique across the whole tree. */
  id: string;
  label: string;
  /** Absolute path used by both the router and NavLink matching. Omitted for group headers with only children. */
  path?: string;
  icon?: ComponentType<{ fontSize?: "small" | "medium" | "large" }>;
  /** Permission required to see this item, RESOURCE_ACTION form (e.g. "USER_VIEW"). Omit for always-visible items. */
  permission?: Permission;
  /**
   * Visible if the user has at least one of these permissions — for a group
   * header whose children are gated by different, mutually-exclusive
   * permissions. Ignored if `permission` is also set. Omit for the common
   * single-permission case.
   */
  anyOfPermissions?: Permission[];
  /** Feature flag key gating visibility. Omit if not feature-flagged. */
  featureFlag?: string;
  /** Set false to hide regardless of permission (e.g. temporarily disabled section). Defaults to true. */
  visible?: boolean;
  order?: number;
  children?: NavigationItem[];
}

export interface NavigationSection {
  id: string;
  label?: string;
  items: NavigationItem[];
}

/** The subset of PermissionContextValue that visibility checks need — avoids importing the provider into a types file. */
export interface NavPermissionChecker {
  hasPermission: (permission: Permission) => boolean;
  hasAnyPermission: (permissions: Permission[]) => boolean;
}

/**
 * Whether a nav item would render anything at all for the current user — a
 * group header (`children`, no `path`) is visible only if at least one
 * descendant is. Sidebar.tsx uses this to decide whether to render a
 * section's own label, so a role with zero permissions in an entire section
 * never sees a bare, empty caption with nothing underneath it.
 */
export function isNavItemVisible(item: NavigationItem, ctx: NavPermissionChecker): boolean {
  if (item.visible === false) return false;
  if (item.permission && !ctx.hasPermission(item.permission)) return false;
  if (item.anyOfPermissions && !ctx.hasAnyPermission(item.anyOfPermissions)) return false;
  if (item.children?.length) {
    return item.children.some((child) => isNavItemVisible(child, ctx));
  }
  return true;
}
