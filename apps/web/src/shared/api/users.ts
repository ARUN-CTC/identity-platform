import { apiRequest } from "./client";
import type { ListParams, PaginatedResult } from "./types";

// Mirrors src/modules/users/dto/user-query.dto.ts
export type UserStatus = "PROVISIONED" | "ACTIVE" | "SUSPENDED" | "DEACTIVATED";

// Mirrors src/modules/users/entities/user.entity.ts. `passwordHash` is never
// included (see UsersService.sanitize() on the backend) — there is no field
// for it here at all, not even omitted at render time.
export interface User {
  id: string;
  email: string;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  status: UserStatus;
  emailVerifiedAt?: string | null;
  lastLoginAt?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  /** BigInt on the backend, serialized as a string (see bigint-json.polyfill.ts) — display only, this app never sends it back (no optimistic-lock check exists server-side; see UsersService.update()). */
  version: string;
}

export interface UserListParams extends ListParams {
  status?: UserStatus;
  search?: string;
}

// Mirrors src/modules/users/dto/create-user.dto.ts — no `password` field:
// creation is invitation-only (see that DTO's own doc comment).
export interface CreateUserInput {
  email: string;
  /** The organization this user is being onboarded into — required. */
  organizationId: string;
  username?: string;
  firstName: string;
  lastName: string;
}

// Mirrors src/modules/users/dto/update-user.dto.ts
export interface UpdateUserInput {
  username?: string;
  firstName?: string;
  lastName?: string;
}

const BASE = "/users";

export function listUsers(params: UserListParams = {}): Promise<PaginatedResult<User>> {
  return apiRequest<PaginatedResult<User>>(BASE, { query: params });
}

export function getUser(id: string): Promise<User> {
  return apiRequest<User>(`${BASE}/${id}`);
}

export function createUser(input: CreateUserInput): Promise<User> {
  return apiRequest<User>(BASE, { method: "POST", body: input });
}

export function updateUser(id: string, input: UpdateUserInput): Promise<User> {
  return apiRequest<User>(`${BASE}/${id}`, { method: "PATCH", body: input });
}

/** PROVISIONED|SUSPENDED -> ACTIVE. Rejects (400 INVALID_USER_TRANSITION) from any other status, and (400 IAM_USER_HAS_NO_PASSWORD) for a still-invited user who hasn't set a password yet. */
export function activateUser(id: string): Promise<User> {
  return apiRequest<User>(`${BASE}/${id}/activate`, { method: "POST" });
}

/** ACTIVE -> SUSPENDED. Revokes every active session for this user immediately. */
export function suspendUser(id: string): Promise<User> {
  return apiRequest<User>(`${BASE}/${id}/suspend`, { method: "POST" });
}

/** PROVISIONED|ACTIVE|SUSPENDED -> DEACTIVATED (terminal). Revokes every active session for this user immediately. */
export function deactivateUser(id: string): Promise<User> {
  return apiRequest<User>(`${BASE}/${id}/deactivate`, { method: "POST" });
}

/**
 * Only valid for a still-INVITED membership in `organizationId` — belongs
 * on the Organization Members list (where organizationId is naturally
 * known), not on User Details, which has no way to resolve which
 * organization's pending invite to resend (see the Users module's own
 * notes on why Membership is organization-centric). Real, backend-enforced
 * failure modes: 409 IAM_USER_ALREADY_ACTIVE (membership isn't INVITED, or
 * doesn't exist) and 429 (a resend was already sent within the last
 * minute — a real server-side cooldown, not something the frontend needs
 * to debounce itself).
 */
export function resendUserInvitation(userId: string, organizationId: string): Promise<null> {
  return apiRequest<null>(`${BASE}/${userId}/resend-invitation`, { method: "POST", body: { organizationId } });
}

/** Soft delete. */
export function deleteUser(id: string): Promise<null> {
  return apiRequest<null>(`${BASE}/${id}`, { method: "DELETE" });
}
