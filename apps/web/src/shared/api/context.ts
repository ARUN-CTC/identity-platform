/**
 * Identity/request context the API client attaches to every outgoing
 * request. Nothing in this module decides *how* these values are obtained
 * (that's config.ts's job) — it only defines the shape and the header
 * mapping, so every call in `auth.ts` (and whatever domain modules follow
 * it — tenants, users, applications, ...) gets this for free instead of
 * each one manually constructing auth headers.
 */
export interface RequestContext {
  /** Sent as `Authorization: Bearer <accessToken>`. */
  accessToken?: string;
  /** Sent as `X-Tenant-Id`. */
  tenantId?: string;
  /** Sent as `X-User-Id`. */
  userId?: string;
  /** Sent as `X-Organization-Id`. */
  organizationId?: string;
}

/** A header is only ever sent when its corresponding context value is present. */
export function buildContextHeaders(context: RequestContext): Record<string, string> {
  const headers: Record<string, string> = {};
  if (context.accessToken) headers.Authorization = `Bearer ${context.accessToken}`;
  if (context.tenantId) headers["X-Tenant-Id"] = context.tenantId;
  if (context.userId) headers["X-User-Id"] = context.userId;
  if (context.organizationId) headers["X-Organization-Id"] = context.organizationId;
  return headers;
}
