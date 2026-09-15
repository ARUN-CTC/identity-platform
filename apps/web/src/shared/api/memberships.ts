import { apiRequest } from "./client";
import type { ListParams, PaginatedResult } from "./types";

// Mirrors src/modules/memberships/dto/membership-status.ts exactly.
// INVITED is set only by the invitation-accept flow — never chosen
// directly by an admin call (see AdminSettableMembershipStatus below).
export type MembershipStatus = "INVITED" | "ACTIVE" | "SUSPENDED" | "REMOVED";
export type AdminSettableMembershipStatus = "ACTIVE" | "SUSPENDED" | "REMOVED";
export const ADMIN_SETTABLE_MEMBERSHIP_STATUSES: AdminSettableMembershipStatus[] = ["ACTIVE", "SUSPENDED", "REMOVED"];

/** The `user` fields MembershipsRepository.listForOrganization() joins in — enough to render a member row with no second lookup. */
export interface MemberUserSummary {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  status: string;
}

// Mirrors the Membership rows GET /organizations/:organizationId/members returns.
export interface Member {
  id: string;
  tenantId: string;
  organizationId: string;
  userId: string;
  status: MembershipStatus;
  createdAt: string;
  updatedAt?: string | null;
  user: MemberUserSummary;
}

const BASE = (organizationId: string) => `/organizations/${organizationId}/members`;

/**
 * Membership is organization-centric only — there is no "list a user's own
 * organizations" admin endpoint (see Users module's own notes). Gated on
 * USER_VIEW server-side, a DIFFERENT permission than the ORGANIZATION_MANAGE
 * this whole Organizations module otherwise requires — a caller could hold
 * one without the other. Callers must check USER_VIEW themselves and
 * degrade gracefully rather than firing a doomed request (see
 * OrganizationDetailsPage's Members tab).
 */
export function listMembers(organizationId: string, params: ListParams = {}): Promise<PaginatedResult<Member>> {
  return apiRequest<PaginatedResult<Member>>(BASE(organizationId), { query: params });
}

/**
 * There is no separate "add member" endpoint — adding an existing or
 * brand-new Identity to an organization IS `POST /users` with that
 * organization's id (see shared/api/users.ts's createUser — CreateUserDto
 * is genuinely dual-purpose). Do not invent a second creation path here.
 */

/**
 * Gated on USER_MANAGE server-side. The backend enforces NO state-machine
 * on this transition (unlike User.status's activate/suspend/deactivate) —
 * `MembershipsService.setStatus()` accepts any of ACTIVE/SUSPENDED/REMOVED
 * from any current status with no `from` check at all. It also has no
 * "cannot remove the last admin" or "cannot remove yourself" guard. Do not
 * invent client-side restrictions the backend doesn't itself enforce —
 * the UI adds a stronger confirmation warning for a self-targeting change
 * instead (see MembershipStatusMenu).
 */
export function updateMembershipStatus(
  organizationId: string,
  userId: string,
  status: AdminSettableMembershipStatus,
): Promise<Member> {
  return apiRequest<Member>(`${BASE(organizationId)}/${userId}`, { method: "PATCH", body: { status } });
}
