import { apiRequest } from "./client";

// Mirrors src/modules/tenants/dto/*.dto.ts and the raw Prisma `Tenant` row
// (see database/prisma/schema/tenant.prisma — no dedicated entity class on
// the backend, same pattern as Organization/Role).
export type TenantStatus = "PROVISIONING" | "ACTIVE" | "SUSPENDED";

export interface TenantRecord {
  id: string;
  tenantCode: string;
  tenantName: string;
  legalName?: string | null;
  email?: string | null;
  phone?: string | null;
  status: TenantStatus;
  activatedAt?: string | null;
  suspendedAt?: string | null;
  createdAt: string;
  updatedAt?: string | null;
}

// Mirrors src/modules/tenants/dto/update-tenant.dto.ts, MINUS `status`.
// UpdateTenantDto technically also accepts `status` (PROVISIONING/ACTIVE/
// SUSPENDED) — deliberately not exposed here. Lifecycle transitions belong
// to the dedicated activate/suspend endpoints (themselves out of scope for
// this tenant-facing settings screen — see this file's header finding
// below), and TenantsService.update()/activate()/suspend() apply no
// state-machine validation at all (no LIFECYCLE_TRANSITIONS-equivalent, no
// version/optimistic-concurrency check on the `version` column), so this
// screen never lets an admin flip their own tenant's status.
export interface UpdateTenantInput {
  tenantName?: string;
  legalName?: string;
  email?: string;
  phone?: string;
}

/**
 * `GET/PATCH /tenants/me` (src/modules/tenants/controllers/tenants.controller.ts)
 * — Phase 2D security remediation. These routes take no id at all; the
 * backend resolves the caller's own tenant exclusively from
 * `RequestContextService.requireTenantId()` (JWT-derived), so there is
 * nothing for a client to substitute another tenant's id into. The prior
 * `/tenants/:id` shape (no ownership check — any TENANT_MANAGE holder could
 * read/modify any tenant by UUID) was removed entirely as part of that fix;
 * the full tenant registry now lives only on `PlatformTenantsController`
 * (`/platform/tenants`), gated by `PlatformJwtAuthGuard` +
 * `RequirePlatformPermissions('PLATFORM_TENANT_VIEW'|'PLATFORM_TENANT_MANAGE')`
 * — permissions that can never be granted to a tenant Role.
 */
export function getOwnTenant(): Promise<TenantRecord> {
  return apiRequest<TenantRecord>("/tenants/me");
}

export function updateOwnTenant(input: UpdateTenantInput): Promise<TenantRecord> {
  return apiRequest<TenantRecord>("/tenants/me", { method: "PATCH", body: input });
}
