/**
 * The single authoritative list of tenant-scope permission codes that exist
 * in the real backend catalog today. Mirrors
 * database/seeds/001_permissions.sql exactly.
 *
 * Do not add a key here speculatively — an invented code always evaluates
 * to "denied" for every user, since PermissionProvider only ever grants
 * what `GET /auth/me` returns from the real database.
 *
 * The `platform_only = TRUE` codes below (PRODUCT_*, APPLICATION_*,
 * PLATFORM_OPERATOR_*, PLATFORM_SECURITY_VIEW, PRODUCT_ENTITLEMENT_*,
 * SERVICE_ACCOUNT_*) can NEVER appear in this array in practice — a
 * database trigger (trg_security_role_permission_no_platform_only) forbids
 * granting them to any tenant-scoped Role, and `/auth/me` (this app's only
 * source of `permissions`) only ever resolves tenant-scoped role grants.
 * They exist as a real, typed catalog only, ready for the day the Platform
 * Administration surface gets its own, separate Platform Operator
 * authentication/authorization flow (see
 * src/modules/platform-operators/ — a wholly distinct login/JWT/guard from
 * this app's tenant session, never a scope a tenant user can switch into).
 */
export const PERMISSIONS = {
  TENANT_MANAGE: "TENANT_MANAGE",
  USER_VIEW: "USER_VIEW",
  USER_MANAGE: "USER_MANAGE",
  ROLE_VIEW: "ROLE_VIEW",
  ROLE_MANAGE: "ROLE_MANAGE",
  PERMISSION_VIEW: "PERMISSION_VIEW",
  SESSION_MANAGE: "SESSION_MANAGE",
  ORGANIZATION_MANAGE: "ORGANIZATION_MANAGE",
  SECURITY_AUDIT_VIEW: "SECURITY_AUDIT_VIEW",
  // Platform-only — see this file's header comment; never granted to a tenant Role.
  PRODUCT_VIEW: "PRODUCT_VIEW",
  PRODUCT_MANAGE: "PRODUCT_MANAGE",
  APPLICATION_VIEW: "APPLICATION_VIEW",
  APPLICATION_MANAGE: "APPLICATION_MANAGE",
  PLATFORM_OPERATOR_VIEW: "PLATFORM_OPERATOR_VIEW",
  PLATFORM_OPERATOR_MANAGE: "PLATFORM_OPERATOR_MANAGE",
  PLATFORM_SECURITY_VIEW: "PLATFORM_SECURITY_VIEW",
  PRODUCT_ENTITLEMENT_VIEW: "PRODUCT_ENTITLEMENT_VIEW",
  PRODUCT_ENTITLEMENT_MANAGE: "PRODUCT_ENTITLEMENT_MANAGE",
  SERVICE_ACCOUNT_VIEW: "SERVICE_ACCOUNT_VIEW",
  SERVICE_ACCOUNT_MANAGE: "SERVICE_ACCOUNT_MANAGE",
  SERVICE_ACCOUNT_TENANT_GRANT_VIEW: "SERVICE_ACCOUNT_TENANT_GRANT_VIEW",
  SERVICE_ACCOUNT_TENANT_GRANT_MANAGE: "SERVICE_ACCOUNT_TENANT_GRANT_MANAGE",
} as const;

/** A real, catalog-backed permission code. Prefer this over raw string literals everywhere. */
export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const KNOWN_CODES = new Set<string>(Object.values(PERMISSIONS));

/** True only for codes that exist in the real backend catalog, not a UI placeholder string. */
export function isKnownPermissionCode(code: string): code is PermissionCode {
  return KNOWN_CODES.has(code);
}
