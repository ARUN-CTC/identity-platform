import { useMemo } from "react";
import { useLocation } from "react-router-dom";

import type { BreadcrumbItem } from "@/design-system/components/Breadcrumbs";
import type { NavigationItem } from "@/shared/types/navigation";

import { navigationSections } from "./navigation";

/**
 * Exact match wins outright (a list page IS its nav item). Failing that,
 * the item whose path is the longest prefix of pathname wins — this is what
 * makes a detail route like /users/:id resolve to the "Users" list item's
 * trail instead of no trail at all.
 */
function findTrail(
  items: NavigationItem[],
  pathname: string,
  trail: NavigationItem[],
): { trail: NavigationItem[]; matchLength: number } | null {
  let best: { trail: NavigationItem[]; matchLength: number } | null = null;
  for (const item of items) {
    const nextTrail = [...trail, item];
    if (item.path === pathname) return { trail: nextTrail, matchLength: item.path.length };
    if (item.path && pathname.startsWith(`${item.path}/`)) {
      if (!best || item.path.length > best.matchLength) {
        best = { trail: nextTrail, matchLength: item.path.length };
      }
    }
    if (item.children) {
      const found = findTrail(item.children, pathname, nextTrail);
      if (found && (!best || found.matchLength > best.matchLength)) best = found;
    }
  }
  return best;
}

/**
 * Derives the breadcrumb trail for the current route from the navigation
 * config, so pages never build their own. Pass `currentLabel` from a detail
 * page once its record has loaded (e.g. a user's display name) to append it
 * as the trail's final, non-link segment — never pass a raw id/UUID here.
 */
export function useBreadcrumbs(currentLabel?: string): BreadcrumbItem[] {
  const location = useLocation();

  return useMemo(() => {
    const allItems = navigationSections.flatMap((section) => section.items);
    const found = findTrail(allItems, location.pathname, []);
    const trail = found?.trail.map((item) => ({ label: item.label, path: item.path })) ?? [];
    return currentLabel ? [...trail, { label: currentLabel }] : trail;
  }, [location.pathname, currentLabel]);
}
