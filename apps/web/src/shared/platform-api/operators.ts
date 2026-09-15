import { platformApiRequest } from "./client";
import type { ListParams, PaginatedResult } from "../api/types";

export type PlatformOperatorStatus = "ACTIVE" | "DISABLED";

export interface PlatformOperatorRecord {
  id: string;
  userId: string;
  status: PlatformOperatorStatus;
  createdAt: string;
  updatedAt?: string | null;
}

export interface PlatformOperatorDetail extends PlatformOperatorRecord {
  permissionCodes: string[];
}

// Mirrors src/modules/platform-operators/dto/create-platform-operator.dto.ts
export interface CreatePlatformOperatorInput {
  email: string;
  permissionCodes: string[];
}

const BASE = "/platform/operators";

/** Gated on PLATFORM_OPERATOR_VIEW. */
export function listPlatformOperators(params: ListParams = {}): Promise<PaginatedResult<PlatformOperatorRecord>> {
  return platformApiRequest<PaginatedResult<PlatformOperatorRecord>>(BASE, { query: params });
}

export function getPlatformOperator(id: string): Promise<PlatformOperatorDetail> {
  return platformApiRequest<PlatformOperatorDetail>(`${BASE}/${id}`);
}

/**
 * Gated on PLATFORM_OPERATOR_MANAGE. The target email must already resolve
 * to an existing, already-activated global Identity with a password set —
 * this never provisions a brand-new account. Every initial permissionCode
 * is grant-ceiling-checked against the caller's own platform permissions
 * server-side (403 INSUFFICIENT_PLATFORM_PRIVILEGE_TO_GRANT if exceeded) —
 * the same rule already enforced for tenant role grants.
 */
export function createPlatformOperator(input: CreatePlatformOperatorInput): Promise<PlatformOperatorDetail> {
  return platformApiRequest<PlatformOperatorDetail>(BASE, { method: "POST", body: input });
}

/** Disabling immediately revokes every session/refresh-token this operator holds. Rejected with 409 if this would leave zero ACTIVE operators. */
export function setPlatformOperatorStatus(id: string, status: PlatformOperatorStatus): Promise<PlatformOperatorRecord> {
  return platformApiRequest<PlatformOperatorRecord>(`${BASE}/${id}`, { method: "PATCH", body: { status } });
}

/** Grant-ceiling enforced server-side — 403 if the caller doesn't hold this code themselves. */
export function grantPlatformOperatorPermission(id: string, permissionCode: string): Promise<null> {
  return platformApiRequest<null>(`${BASE}/${id}/permissions`, { method: "POST", body: { permissionCode } });
}

export function revokePlatformOperatorPermission(id: string, permissionCode: string): Promise<null> {
  return platformApiRequest<null>(`${BASE}/${id}/permissions/${permissionCode}`, { method: "DELETE" });
}
