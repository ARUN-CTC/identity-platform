import { platformApiRequest } from "./client";
import type { ListParams, PaginatedResult } from "../api/types";

// Mirrors PlatformAuditService.listEvents()'s raw securityEvent rows,
// always scope='PLATFORM' (tenantId always null by construction — enforced
// by RLS on security_event, not merely this endpoint's own WHERE clause).
export interface PlatformSecurityEvent {
  id: string;
  tenantId: string | null;
  actorUserId: string | null;
  scope: string;
  eventType: string;
  resourceType?: string | null;
  resourceId?: string | null;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
  createdAt: string;
}

export interface PlatformAuditListParams extends ListParams {
  /** Exact match, not a search — see platform-audit-query.dto.ts. */
  eventType?: string;
}

/** Gated on PLATFORM_SECURITY_VIEW server-side (PlatformAuditController). */
export function listPlatformAuditEvents(params: PlatformAuditListParams = {}): Promise<PaginatedResult<PlatformSecurityEvent>> {
  return platformApiRequest<PaginatedResult<PlatformSecurityEvent>>("/platform/audit-events", { query: params });
}
