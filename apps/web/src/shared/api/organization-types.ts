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

const BASE = "/organization-types";

/** Gated on ORGANIZATION_MANAGE, same as Organizations itself — used to populate the Create Organization form's type picker. */
export function listOrganizationTypes(params: ListParams = {}): Promise<PaginatedResult<OrganizationType>> {
  return apiRequest<PaginatedResult<OrganizationType>>(BASE, { query: params });
}
