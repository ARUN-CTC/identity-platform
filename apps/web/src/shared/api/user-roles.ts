import { apiRequest } from "./client";

// The `role` relation the backend includes on every grant row (see
// UserRolesRepository.findMany's `include: { role: true }`) — just enough
// to display without a second lookup.
export interface UserRoleSummary {
  id: string;
  roleCode: string;
  roleName: string;
}

// Mirrors the SecurityUserRole rows returned by GET /users/:userId/roles.
export interface UserRoleGrant {
  id: string;
  userId: string;
  roleId: string;
  /** Null means a tenant-wide grant; otherwise scoped to this one organization. */
  organizationId: string | null;
  createdAt: string;
  role: UserRoleSummary;
}

export interface AssignRoleInput {
  roleId: string;
  /** Omit for a tenant-wide grant. */
  organizationId?: string;
}

const BASE = (userId: string) => `/users/${userId}/roles`;

export function listUserRoles(userId: string): Promise<UserRoleGrant[]> {
  return apiRequest<UserRoleGrant[]>(BASE(userId));
}

/**
 * Grants a role — new or pre-existing — and its full permission set
 * immediately. The backend independently re-checks that the caller already
 * holds every permission the role carries (ROLE-SECURITY-001) and that the
 * grantee has an active membership backing the grant's scope; both are
 * real, enforced 403/400s this call can surface, never a frontend-only
 * check.
 */
export function assignUserRole(userId: string, input: AssignRoleInput): Promise<UserRoleGrant> {
  return apiRequest<UserRoleGrant>(BASE(userId), { method: "POST", body: input });
}

export function revokeUserRole(userId: string, grantId: string): Promise<null> {
  return apiRequest<null>(`${BASE(userId)}/${grantId}`, { method: "DELETE" });
}
