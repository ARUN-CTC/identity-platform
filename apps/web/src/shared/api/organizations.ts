import { apiRequest } from "./client";
import type { ListParams, PaginatedResult } from "./types";

// Mirrors src/modules/organizations/dto/update-organization.dto.ts — the
// only two values PATCH /organizations/:id accepts for `status`. (There is
// no SUSPENDED/REVOKED/DELETED — do not invent additional statuses.)
export type OrganizationStatus = "ACTIVE" | "INACTIVE";

// Mirrors the Organization fields (raw Prisma row — see
// OrganizationsService, no dedicated entity class).
export interface Organization {
  id: string;
  organizationTypeId: string;
  organizationCode: string;
  organizationName: string;
  legalName?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  status: OrganizationStatus;
  remarks?: string | null;
  createdAt: string;
  updatedAt?: string | null;
}

/** The lookup-only subset other modules (Users' role-assignment scope picker) actually need. */
export interface OrganizationSummary {
  id: string;
  organizationCode: string;
  organizationName: string;
  status: string;
}

// Mirrors src/modules/organizations/dto/create-organization.dto.ts
export interface CreateOrganizationInput {
  organizationTypeId: string;
  organizationCode: string;
  organizationName: string;
  legalName?: string;
  email?: string;
  phone?: string;
  website?: string;
}

// Mirrors src/modules/organizations/dto/update-organization.dto.ts — every
// CreateOrganizationInput field except organizationCode (immutable after
// creation — OmitType on the backend), plus status.
export type UpdateOrganizationInput = Partial<Omit<CreateOrganizationInput, "organizationCode">> & {
  status?: OrganizationStatus;
};

const BASE = "/organizations";

/**
 * `GET /organizations` accepts only page/limit/sortBy/sortOrder
 * (PaginationQueryDto) — there is no search or status/type filter on the
 * backend today (OrganizationsRepository.findMany has no such WHERE
 * clause). The Organizations directory intentionally has no search box or
 * filters as a result — adding one would be UI that lies about what the
 * API can do.
 */
export function listOrganizations(params: ListParams = {}): Promise<PaginatedResult<OrganizationSummary>> {
  return apiRequest<PaginatedResult<OrganizationSummary>>(BASE, { query: params });
}

export function getOrganization(id: string): Promise<Organization> {
  return apiRequest<Organization>(`${BASE}/${id}`);
}

export function createOrganization(input: CreateOrganizationInput): Promise<Organization> {
  return apiRequest<Organization>(BASE, { method: "POST", body: input });
}

export function updateOrganization(id: string, input: UpdateOrganizationInput): Promise<Organization> {
  return apiRequest<Organization>(`${BASE}/${id}`, { method: "PATCH", body: input });
}

/**
 * Soft delete. The backend does NOT check for existing members before
 * allowing this (OrganizationsService.remove() calls findOne() then
 * deleteMany() unconditionally, no membership-count guard) — a known
 * backend limitation, not something the frontend can safely paper over by
 * pretending it's blocked. The confirmation UX (see OrganizationDetailsPage)
 * fetches and surfaces the member count so an admin isn't surprised, but
 * the action itself is never disabled based on it, since the backend
 * genuinely allows it.
 */
export function deleteOrganization(id: string): Promise<null> {
  return apiRequest<null>(`${BASE}/${id}`, { method: "DELETE" });
}
