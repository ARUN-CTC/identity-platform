import { apiRequest } from "./client";
import type { ListParams, PaginatedResult } from "./types";

// Mirrors the SecurityRole fields the backend actually returns (raw Prisma
// row — see RolesService.list()/findOne(), no dedicated entity class).
// There is no `status` field — roles have no lifecycle/state machine at
// all (do not invent ACTIVE/INACTIVE for them).
export interface Role {
  id: string;
  /** Null for a system role (SUPER_ADMIN/TENANT_ADMIN/MEMBER) — shared across every tenant. */
  tenantId: string | null;
  roleCode: string;
  roleName: string;
  description?: string | null;
  isSystem: boolean;
  createdAt: string;
  updatedAt?: string | null;
}

export interface RoleListParams extends ListParams {
  search?: string;
  /** Defaults true server-side — include platform-wide system roles (SUPER_ADMIN/TENANT_ADMIN/MEMBER) alongside this tenant's own custom roles. */
  includeSystem?: boolean;
}

// Mirrors src/modules/roles/dto/create-role.dto.ts
export interface CreateRoleInput {
  /** UPPER_SNAKE_CASE, max 50 chars — immutable after creation. */
  roleCode: string;
  roleName: string;
  description?: string;
}

// Mirrors src/modules/roles/dto/update-role.dto.ts — every CreateRoleInput
// field except roleCode (OmitType on the backend). Rejected with 400
// SYSTEM_ROLE_IMMUTABLE for a system role (isSystem: true) regardless of
// what's sent.
export type UpdateRoleInput = Partial<Omit<CreateRoleInput, "roleCode">>;

const BASE = "/roles";

/**
 * GET /roles never returns SUPER_ADMIN to a caller who doesn't themselves
 * hold it (see RolesService.callerHoldsSuperAdmin()) — this is a real,
 * backend-enforced narrowing, not something the frontend needs to
 * replicate; whatever comes back is exactly what the current caller may
 * see and (separately, re-checked again at grant time) may assign.
 */
export function listRoles(params: RoleListParams = {}): Promise<PaginatedResult<Role>> {
  return apiRequest<PaginatedResult<Role>>(BASE, { query: params });
}

export function getRole(id: string): Promise<Role> {
  return apiRequest<Role>(`${BASE}/${id}`);
}

export function createRole(input: CreateRoleInput): Promise<Role> {
  return apiRequest<Role>(BASE, { method: "POST", body: input });
}

/** 400 SYSTEM_ROLE_IMMUTABLE for a system role — never attempt this for one (RoleFormDrawer/RoleDetailsPage hide/disable edit for isSystem roles, but the backend is what actually enforces it). */
export function updateRole(id: string, input: UpdateRoleInput): Promise<Role> {
  return apiRequest<Role>(`${BASE}/${id}`, { method: "PATCH", body: input });
}

/** 400 SYSTEM_ROLE_IMMUTABLE for a system role; 409 if any user still holds this role (see RolesService.remove()'s countActiveGrants check) — revoke it from every user first. */
export function deleteRole(id: string): Promise<null> {
  return apiRequest<null>(`${BASE}/${id}`, { method: "DELETE" });
}

// Mirrors the SecurityRolePermission rows GET /roles/:roleId/permissions
// returns — a raw grant row with no joined permission details (unlike
// SecurityUserRole's role join). Callers that need the permission's own
// code/resource/action must cross-reference the permission catalog
// (shared/api/permissions.ts) by permissionId themselves.
export interface RolePermissionGrant {
  id: string;
  roleId: string;
  permissionId: string;
  createdAt: string;
}

const rolePermissionsBase = (roleId: string) => `${BASE}/${roleId}/permissions`;

export function listRolePermissions(roleId: string): Promise<RolePermissionGrant[]> {
  return apiRequest<RolePermissionGrant[]>(rolePermissionsBase(roleId));
}

/**
 * ROLE-SECURITY-001, with a deliberate asymmetry from user→role assignment
 * (see shared/api/user-roles.ts): the backend allows this when the caller
 * either already holds `permissionId`'s own code, OR holds TENANT_MANAGE —
 * the latter is a real, intentional bypass (a brand-new permission nobody
 * has ever been granted could otherwise never be attached to any role by
 * anyone, including the SUPER_ADMIN who just created it). A DB trigger
 * (trg_security_role_permission_no_platform_only) separately and
 * unconditionally blocks attaching a `platformOnly` permission to any
 * tenant role — that check has no application-level pre-validation and
 * currently surfaces as a generic 500, not a specific 400/403 (a real
 * backend gap; see the module's own findings) — the permission picker
 * this feeds (GrantPermissionDialog) proactively excludes platform-only
 * permissions so a normal admin never hits it, without that UI filter
 * being the actual security boundary (the trigger is).
 */
export function grantRolePermission(roleId: string, permissionId: string): Promise<RolePermissionGrant> {
  return apiRequest<RolePermissionGrant>(rolePermissionsBase(roleId), { method: "POST", body: { permissionId } });
}

export function revokeRolePermission(roleId: string, permissionId: string): Promise<null> {
  return apiRequest<null>(`${rolePermissionsBase(roleId)}/${permissionId}`, { method: "DELETE" });
}
