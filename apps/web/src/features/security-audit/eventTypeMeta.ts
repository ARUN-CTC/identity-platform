/**
 * The real, complete tenant-visible security event taxonomy — built by
 * grepping every `securityEvents.record(...)` call site in the backend
 * (not `recordPlatformEvent`, which writes PLATFORM-scoped rows that
 * `GET /security-audit/events` can never return to a tenant caller — it
 * filters `tenantId = this tenant`, which a PLATFORM row, tenantId NULL by
 * construction, never matches).
 *
 * Deliberately excluded, and why: every Application/Product/ServiceAccount/
 * ProductEntitlement event (APPLICATION_CREATED, PRODUCT_CREATED,
 * SERVICE_ACCOUNT_*, PRODUCT_ENTITLEMENT_*) and the Client-Credentials
 * OAuth flow's OAUTH_TOKEN_ISSUED/OAUTH_TOKEN_DENIED are recorded
 * exclusively via `recordPlatformEvent` — including any of these as a
 * filter option here would be exactly the SESSION_MANAGE-style dead
 * option this codebase has already twice caught and removed elsewhere.
 * Every PLATFORM_* event (platform-operator login/CRUD) is a Platform
 * Operator concern, a separate security boundary this app doesn't
 * administer (see shared/auth/useRoleContext.ts's own doc comment).
 *
 * If the backend ever adds a new tenant-scoped event type, an event of
 * that type still displays correctly (see EventDetailModal / the events
 * table) — this list only curates the FilterSelect's options, it is not
 * a validation allow-list.
 */
export const KNOWN_TENANT_EVENT_TYPES: { value: string; label: string }[] = [
  { value: "LOGIN_SUCCESS", label: "Login succeeded" },
  { value: "security.suspicious_login", label: "Suspicious login (refresh token reuse)" },
  { value: "account.locked", label: "Account locked" },
  { value: "account.password_changed", label: "Password changed" },
  { value: "account.password_reset_requested", label: "Password reset requested" },
  { value: "account.password_reset_completed", label: "Password reset completed" },
  { value: "organization_context.switched", label: "Organization context switched" },
  { value: "organization_context.cleared", label: "Organization context cleared" },
  { value: "organization_context.cleared_stale", label: "Organization context cleared (stale)" },
  { value: "organization_context.denied", label: "Organization context switch denied" },
  { value: "iam.user_created", label: "User created" },
  { value: "iam.user_activated", label: "User activated" },
  { value: "iam.user_suspended", label: "User suspended" },
  { value: "iam.user_deactivated", label: "User deactivated" },
  { value: "iam.user_invited", label: "User invited" },
  { value: "iam.invitation_resent", label: "Invitation resent" },
  { value: "iam.invitation_accepted", label: "Invitation accepted" },
  { value: "iam.membership_created", label: "Membership created" },
  { value: "iam.membership_status_changed", label: "Membership status changed" },
  { value: "iam.membership_removed", label: "Membership removed" },
  { value: "iam.role_granted", label: "Role granted" },
  { value: "iam.role_revoked", label: "Role revoked" },
  { value: "iam.role_permission_granted", label: "Permission granted to role" },
  { value: "iam.role_permission_revoked", label: "Permission revoked from role" },
  { value: "OAUTH_AUTHORIZATION_CODE_ISSUED", label: "OAuth authorization code issued" },
  { value: "OAUTH_AUTHORIZATION_DENIED", label: "OAuth authorization denied" },
  { value: "OAUTH_AUTHORIZATION_CODE_REDEEMED", label: "OAuth authorization code redeemed" },
  { value: "OIDC_ID_TOKEN_ISSUED", label: "OIDC ID token issued" },
  { value: "OAUTH_AUTHORIZATION_CODE_DENIED", label: "OAuth token exchange denied" },
  { value: "OAUTH_AUTHORIZATION_CODE_REPLAYED", label: "OAuth authorization code reused (replay attempt)" },
  { value: "OIDC_USERINFO_ACCESSED", label: "OIDC userinfo accessed" },
  { value: "OIDC_USERINFO_DENIED", label: "OIDC userinfo access denied" },
];

const EVENT_LABEL_BY_CODE = new Map(KNOWN_TENANT_EVENT_TYPES.map((e) => [e.value, e.label]));

export function getEventTypeLabel(eventType: string): string {
  return EVENT_LABEL_BY_CODE.get(eventType) ?? eventType;
}

/**
 * Metadata is arbitrary JSON set by whichever service recorded the event —
 * there is no single schema across ~30 event types, so this is a
 * deny-list, not a per-type allow-list: every real metadata payload this
 * backend actually writes (verified by reading every `securityEvents
 * .record()` call site — ids, codes, statuses, booleans, reasons) is safe,
 * structured, small key-value data; nothing observed anywhere carries a
 * credential. This filter exists as defense-in-depth against a future
 * call site accidentally doing so, and as an explicit safety net rather
 * than a blind `JSON.stringify(metadata)`. If the backend is ever found
 * to persist a real secret in event metadata, that is a backend finding
 * to fix at the source, not something for this filter to paper over.
 */
const SENSITIVE_KEY_PATTERN = /password|token|secret|credential|authoriz(a|e)tion|cookie|private.?key|api.?key/i;

export interface SafeMetadataEntry {
  key: string;
  value: string;
}

export function renderSafeMetadata(metadata: Record<string, unknown> | null | undefined): SafeMetadataEntry[] {
  if (!metadata) return [];
  return Object.entries(metadata)
    .filter(([key]) => !SENSITIVE_KEY_PATTERN.test(key))
    .map(([key, value]) => ({ key, value: formatMetadataValue(value) }));
}

function formatMetadataValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
