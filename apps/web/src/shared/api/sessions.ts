import { apiRequest } from "./client";

// Mirrors the SecuritySession fields (raw Prisma row — see
// SessionsService/SessionsRepository, no dedicated entity class).
export interface Session {
  id: string;
  userId: string;
  organizationId: string | null;
  deviceInfo?: string | null;
  ipAddress?: string | null;
  createdAt: string;
  lastUsedAt?: string | null;
  expiresAt: string;
  revokedAt?: string | null;
  revokedReason?: string | null;
  rememberMe: boolean;
}

/**
 * Self-service only — there is no admin endpoint to list or revoke another
 * user's sessions (see src/modules/sessions/controllers/sessions.controller.ts;
 * every route here reads the caller's own identity from the JWT, never an
 * `:id`/`:userId` path param). The `SESSION_MANAGE` permission exists in
 * the catalog but is not checked by any endpoint today — these three
 * calls require nothing beyond being signed in, same as TravelOS's own
 * self-service `/iam/security` page.
 */
const BASE = "/sessions";

/** Every session ever issued to the caller in this tenant, most recent first — active, expired, and revoked alike (see SessionsRepository.findManyForUser, no filter/pagination). */
export function listMySessions(): Promise<Session[]> {
  return apiRequest<Session[]>(`${BASE}/me`);
}

/** 404 if the id doesn't exist; 403 (real, backend-enforced) if it exists but belongs to someone else. Revoking an already-revoked session is a silent, idempotent no-op — see SessionsRepository.revoke()'s `revokedAt: null` guard. */
export function revokeSession(id: string): Promise<void> {
  return apiRequest<void>(`${BASE}/${id}`, { method: "DELETE" });
}

/** Signs the caller out of every device/browser except the one making this call. */
export function revokeOtherSessions(): Promise<void> {
  return apiRequest<void>(`${BASE}/revoke-others`, { method: "POST" });
}
