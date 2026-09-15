import { describe, expect, it } from "vitest";

import { PERMISSIONS } from "@/shared/auth/permissions";

import { navigationSections } from "./navigation";

function flattenAll(items = navigationSections.flatMap((s) => s.items)): typeof items {
  return items.flatMap((item) => [item, ...(item.children ? flattenAll(item.children) : [])]);
}

describe("navigationSections", () => {
  const allItems = flattenAll();

  // SESSION_MANAGE is checked by no backend endpoint at all (see
  // navigation.ts's own header comment) — a nav item gated on it would be
  // permanently invisible-or-broken for every real caller. Regression test
  // for that specific finding.
  it("never gates a nav item on the unenforced SESSION_MANAGE permission", () => {
    const offenders = allItems.filter((item) => item.permission === PERMISSIONS.SESSION_MANAGE);
    expect(offenders).toEqual([]);
  });

  it("exposes 'My Sessions' as an always-visible self-service item, not permission-gated", () => {
    const mySessions = allItems.find((item) => item.id === "my-sessions");
    expect(mySessions).toBeDefined();
    expect(mySessions?.path).toBe("/my-sessions");
    expect(mySessions?.permission).toBeUndefined();
    expect(mySessions?.anyOfPermissions).toBeUndefined();
  });

  // PRODUCT_ENTITLEMENT_VIEW/MANAGE and PRODUCT_VIEW/MANAGE are all
  // platform_only = TRUE (database/seeds/001_permissions.sql) — never
  // grantable to a tenant Role, so never usable to gate a tenant-sidebar
  // item (same dead-permission class as SESSION_MANAGE above). The real
  // tenant-facing endpoint needs no permission at all.
  it("never gates a nav item on a platform_only product/entitlement permission", () => {
    const offenders = allItems.filter((item) =>
      [PERMISSIONS.PRODUCT_ENTITLEMENT_VIEW, PERMISSIONS.PRODUCT_ENTITLEMENT_MANAGE, PERMISSIONS.PRODUCT_VIEW, PERMISSIONS.PRODUCT_MANAGE].includes(
        item.permission as never,
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("exposes 'Product Entitlements' as an always-visible self-service item, not permission-gated", () => {
    const productEntitlements = allItems.find((item) => item.id === "product-entitlements");
    expect(productEntitlements).toBeDefined();
    expect(productEntitlements?.path).toBe("/product-entitlements");
    expect(productEntitlements?.permission).toBeUndefined();
    expect(productEntitlements?.anyOfPermissions).toBeUndefined();
  });

  // Applications/OAuth and Service Accounts modules: APPLICATION_VIEW/MANAGE
  // and SERVICE_ACCOUNT_VIEW/MANAGE + SERVICE_ACCOUNT_TENANT_GRANT_VIEW/MANAGE
  // are all platform_only = TRUE — confirmed exhaustively that ZERO
  // tenant-reachable endpoint exists for either module (every controller is
  // PlatformJwtAuthGuard + PlatformPermissionsGuard only). No nav item exists
  // for either today; this guards against one ever being added gated on one
  // of these dead-for-tenant-UI codes.
  it("never gates a nav item on a platform_only application/service-account permission", () => {
    const offenders = allItems.filter((item) =>
      [
        PERMISSIONS.APPLICATION_VIEW,
        PERMISSIONS.APPLICATION_MANAGE,
        PERMISSIONS.SERVICE_ACCOUNT_VIEW,
        PERMISSIONS.SERVICE_ACCOUNT_MANAGE,
        PERMISSIONS.SERVICE_ACCOUNT_TENANT_GRANT_VIEW,
        PERMISSIONS.SERVICE_ACCOUNT_TENANT_GRANT_MANAGE,
      ].includes(item.permission as never),
    );
    expect(offenders).toEqual([]);
  });

  it("every permission referenced by a nav item is a real catalog code", () => {
    const knownCodes = new Set<string>(Object.values(PERMISSIONS));
    for (const item of allItems) {
      if (item.permission) expect(knownCodes.has(item.permission)).toBe(true);
      for (const perm of item.anyOfPermissions ?? []) expect(knownCodes.has(perm)).toBe(true);
    }
  });
});
