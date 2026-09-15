import { apiRequest } from "./client";
import type { ListParams, PaginatedResult } from "./types";

// Mirrors the SecurityEvent fields (raw Prisma row — see
// SecurityAuditQueryService, no dedicated entity class). Append-only: the
// backend (SecurityEventsService) exposes no update/delete method at all.
// There is also no single-item GET endpoint — every field a caller could
// ever see about one event is already present on the list row; a "detail
// view" is a client-side expansion of that same row, never a fresh fetch.
export interface SecurityEvent {
  id: string;
  tenantId: string | null;
  actorUserId: string | null;
  /** Always "TENANT" for anything this endpoint can return — it explicitly filters `tenantId = this tenant`, which a PLATFORM-scoped row (tenantId NULL by construction) can never match. */
  scope: string;
  eventType: string;
  resourceType?: string | null;
  resourceId?: string | null;
  /** Arbitrary, per-eventType JSON set by whichever service recorded it — never render this with a blind stringify. See eventTypeMeta.ts's `renderSafeMetadata`. */
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
  createdAt: string;
}

export interface SecurityEventListParams extends ListParams {
  actorUserId?: string;
  /** Exact match, not a search — see security-event-query.dto.ts. There is no free-text search across events, and no date-range or correlationId filter at all; do not build UI implying otherwise. */
  eventType?: string;
}

// Mirrors the SecurityLoginAttempt fields (raw Prisma row).
export interface LoginAttempt {
  id: string;
  tenantId: string | null;
  userId: string | null;
  /** The email/tenant-code typed at login — populated even when it matched no real account (a failed attempt's only "who"). */
  identifier: string;
  success: boolean;
  failureReason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string;
}

export interface LoginAttemptListParams extends ListParams {
  userId?: string;
  /** A real, case-insensitive "contains" search on `identifier` — the one genuine free-text search this module has. */
  identifier?: string;
  /** Sent as the literal string "true"/"false" — see login-attempt-query.dto.ts's own @IsIn(['true','false']). */
  success?: "true" | "false";
}

const BASE = "/security-audit";

/**
 * Gated on SECURITY_AUDIT_VIEW server-side, verified enforced (not another
 * SESSION_MANAGE-style dead permission) by reading the controller directly.
 * Tenant-wide, not organization-scoped — a SECURITY_AUDIT_VIEW holder sees
 * every event across the whole tenant regardless of their own active
 * organization context; this is the real, intended backend behavior, not
 * a gap.
 */
export function listSecurityEvents(params: SecurityEventListParams = {}): Promise<PaginatedResult<SecurityEvent>> {
  return apiRequest<PaginatedResult<SecurityEvent>>(`${BASE}/events`, { query: params });
}

export function listLoginAttempts(params: LoginAttemptListParams = {}): Promise<PaginatedResult<LoginAttempt>> {
  return apiRequest<PaginatedResult<LoginAttempt>>(`${BASE}/login-attempts`, { query: params });
}
