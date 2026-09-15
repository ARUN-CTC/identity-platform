/**
 * Loose permission-identifier type used by the plumbing (PermissionGate,
 * PermissionProvider, PermissionRoute). For any permission that actually
 * exists in the backend catalog, use `PermissionCode` from
 * `@/shared/auth/permissions` instead of a raw string literal — that's the
 * authoritative, typo-proof registry.
 *
 * Frontend permission checks are a UX convenience only — they hide/disable
 * actions a user can't perform, but the backend remains the authorization
 * boundary. Never treat a passed frontend check as proof an action is safe.
 */
export type Permission = string;
