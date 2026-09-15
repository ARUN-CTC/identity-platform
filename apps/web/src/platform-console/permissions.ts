/**
 * The Platform Operator permission catalog — every `platform_only = TRUE`
 * code in `database/seeds/001_permissions.sql`, verified enforced by
 * `PlatformPermissionsGuard` on a real controller during this project's own
 * Phase 2 module-by-module backend discovery (Products, Product
 * Entitlements, Applications, Service Accounts, Platform Operators, and —
 * the Phase 2D security remediation — the Tenant Registry). Do not add a
 * code here speculatively; an invented code always evaluates to "denied",
 * since `usePlatformAuth().permissionCodes` only ever reflects what
 * `GET /platform/auth/me` actually returns.
 */
export const PLATFORM_PERMISSIONS = {
  PLATFORM_TENANT_VIEW: "PLATFORM_TENANT_VIEW",
  PLATFORM_TENANT_MANAGE: "PLATFORM_TENANT_MANAGE",
  PRODUCT_VIEW: "PRODUCT_VIEW",
  PRODUCT_MANAGE: "PRODUCT_MANAGE",
  PRODUCT_ENTITLEMENT_VIEW: "PRODUCT_ENTITLEMENT_VIEW",
  PRODUCT_ENTITLEMENT_MANAGE: "PRODUCT_ENTITLEMENT_MANAGE",
  APPLICATION_VIEW: "APPLICATION_VIEW",
  APPLICATION_MANAGE: "APPLICATION_MANAGE",
  SERVICE_ACCOUNT_VIEW: "SERVICE_ACCOUNT_VIEW",
  SERVICE_ACCOUNT_MANAGE: "SERVICE_ACCOUNT_MANAGE",
  SERVICE_ACCOUNT_TENANT_GRANT_VIEW: "SERVICE_ACCOUNT_TENANT_GRANT_VIEW",
  SERVICE_ACCOUNT_TENANT_GRANT_MANAGE: "SERVICE_ACCOUNT_TENANT_GRANT_MANAGE",
  PLATFORM_OPERATOR_VIEW: "PLATFORM_OPERATOR_VIEW",
  PLATFORM_OPERATOR_MANAGE: "PLATFORM_OPERATOR_MANAGE",
  PLATFORM_SECURITY_VIEW: "PLATFORM_SECURITY_VIEW",
} as const;

export type PlatformPermissionCode = (typeof PLATFORM_PERMISSIONS)[keyof typeof PLATFORM_PERMISSIONS];

const KNOWN_CODES = new Set<string>(Object.values(PLATFORM_PERMISSIONS));

export function isKnownPlatformPermissionCode(code: string): code is PlatformPermissionCode {
  return KNOWN_CODES.has(code);
}
