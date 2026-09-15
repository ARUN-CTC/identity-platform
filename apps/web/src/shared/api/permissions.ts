import { apiRequest } from "./client";
import type { ListParams, PaginatedResult } from "./types";

// Mirrors the SecurityPermission fields (raw Prisma row — see
// PermissionsService, no dedicated entity class).
export interface Permission {
  id: string;
  permissionCode: string;
  resource: string;
  action: string;
  description?: string | null;
  isSystem: boolean;
  /** Never attachable to a tenant Role — see grantRolePermission's own doc comment. Display this prominently; do not present platform-only and tenant permissions as an undifferentiated list. */
  platformOnly: boolean;
  createdAt: string;
  updatedAt?: string | null;
}

export interface PermissionListParams extends ListParams {
  resource?: string;
  /** Matches against permissionCode. */
  search?: string;
}

// Mirrors src/modules/permissions/dto/create-permission.dto.ts. There is no
// `platformOnly` field here — the API has no way to set it true; every
// permission created through this UI is necessarily a tenant-grantable one
// (platform-only permissions exist only via seed/migration).
export interface CreatePermissionInput {
  /** UPPER_SNAKE_CASE, max 100 chars. */
  permissionCode: string;
  resource: string;
  action: string;
  description?: string;
  isSystem?: boolean;
}

// Mirrors src/modules/permissions/dto/update-permission.dto.ts exactly —
// description is the ONLY editable field. permissionCode/resource/action/
// isSystem are the permission's identity: allowing a rename would let a
// caller free a sensitive code and reassign it to a different permission,
// bypassing RolePermissionsService's grant-ceiling check (which operates on
// stable permission ids, not codes) — do not add more fields to an edit
// form than this.
export interface UpdatePermissionInput {
  description?: string;
}

const BASE = "/permissions";

export function listPermissions(params: PermissionListParams = {}): Promise<PaginatedResult<Permission>> {
  return apiRequest<PaginatedResult<Permission>>(BASE, { query: params });
}

export function getPermission(id: string): Promise<Permission> {
  return apiRequest<Permission>(`${BASE}/${id}`);
}

/** Gated on ROLE_MANAGE server-side, not a separate PERMISSION_MANAGE code — there is no such permission in the real catalog (confirmed: zero references in the backend). */
export function createPermission(input: CreatePermissionInput): Promise<Permission> {
  return apiRequest<Permission>(BASE, { method: "POST", body: input });
}

export function updatePermission(id: string, input: UpdatePermissionInput): Promise<Permission> {
  return apiRequest<Permission>(`${BASE}/${id}`, { method: "PATCH", body: input });
}

/** 409 if any role still holds this permission (PermissionsService.remove()'s countActiveGrants check) — revoke it from every role first. */
export function deletePermission(id: string): Promise<null> {
  return apiRequest<null>(`${BASE}/${id}`, { method: "DELETE" });
}
