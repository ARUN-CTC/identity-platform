import { apiRequest } from "./client";
import type { ListParams, PaginatedResult } from "./types";

// Mirrors the OrganizationType fields (raw Prisma row).
export interface OrganizationType {
  id: string;
  typeCode: string;
  typeName: string;
  description?: string | null;
  isActive: boolean;
}

// Mirrors src/modules/organization-types/dto/create-organization-type.dto.ts
// exactly (typeCode max 50, typeName max 100, isActive defaults true
// server-side when omitted).
export interface CreateOrganizationTypeInput {
  typeCode: string;
  typeName: string;
  description?: string;
  isActive?: boolean;
}

// Mirrors src/modules/organization-types/dto/update-organization-type.dto.ts
// exactly — PartialType(OmitType(CreateOrganizationTypeDto, ['typeCode'])):
// every Create field except typeCode, which is this type's stable identity
// and cannot be changed after creation (same convention as Permission's
// own identity fields — see permissions.ts's UpdatePermissionInput comment).
export interface UpdateOrganizationTypeInput {
  typeName?: string;
  description?: string;
  isActive?: boolean;
}

const BASE = "/organization-types";

/** Gated on ORGANIZATION_MANAGE, same as Organizations itself — used to populate the Create Organization form's type picker. */
export function listOrganizationTypes(params: ListParams = {}): Promise<PaginatedResult<OrganizationType>> {
  return apiRequest<PaginatedResult<OrganizationType>>(BASE, { query: params });
}

export function getOrganizationType(id: string): Promise<OrganizationType> {
  return apiRequest<OrganizationType>(`${BASE}/${id}`);
}

export function createOrganizationType(input: CreateOrganizationTypeInput): Promise<OrganizationType> {
  return apiRequest<OrganizationType>(BASE, { method: "POST", body: input });
}

export function updateOrganizationType(id: string, input: UpdateOrganizationTypeInput): Promise<OrganizationType> {
  return apiRequest<OrganizationType>(`${BASE}/${id}`, { method: "PATCH", body: input });
}

/**
 * Soft-deletes (organization_type has the same standard soft-delete trigger
 * as every other reference table — a real DB-level DELETE never happens).
 * OrganizationTypesService.remove() does NOT check whether any Organization
 * still references this type first (confirmed: no countActiveGrants-style
 * guard, unlike Permission's delete) — this always succeeds (200) for an
 * existing id, it never returns 409 for "still in use". Organizations that
 * already reference a since-deleted type keep their existing
 * organizationTypeId untouched; the type simply stops appearing in this
 * list (and therefore in the Create/Edit Organization type picker) for new
 * assignments.
 */
export function deleteOrganizationType(id: string): Promise<null> {
  return apiRequest<null>(`${BASE}/${id}`, { method: "DELETE" });
}
