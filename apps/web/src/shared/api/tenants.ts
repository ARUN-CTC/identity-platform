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
 * ⚠ KNOWN BACKEND FINDING — cross-tenant authorization gap, not a frontend
 * workaround target.
 *
 * `GET/PATCH /tenants/:id` are gated only by `@RequirePermissions('TENANT_MANAGE')`
 * (src/modules/tenants/controllers/tenants.controller.ts) — a permission any
 * tenant's own SUPER_ADMIN role legitimately holds (TENANT_MANAGE is
 * tenant-grantable, not platform_only — see shared/auth/permissions.ts).
 * `TenantsRepository`'s own source comment states plainly: "tenant has no
 * RLS (it is the tenant registry itself, not tenant-scoped)". Every method
 * — findById/update/activate/suspend/softDelete — takes the path-param id
 * and operates on it with ZERO ownership check against the caller's own
 * tenant. There is no `GET /tenants` list endpoint restriction either: it
 * returns every tenant on the platform.
 *
 * Net effect: any tenant admin holding TENANT_MANAGE can read or modify ANY
 * OTHER tenant in the system by UUID, not just their own, simply by calling
 * the API directly (this has nothing to do with what this frontend renders
 * — the backend accepts the request regardless).
 *
 * This module does NOT fix that — it cannot be fixed from the frontend.
 * What it does do, as a deliberate, load-bearing constraint:
 *   - `getOwnTenant`/`updateOwnTenant` below are the ONLY entry points this
 *     app exposes to `/tenants/:id`.
 *   - The `id` they take must always be the caller's own
 *     `useTenant().tenant.id` (sourced from `GET /auth/me` via TenantProvider, never from a URL
 *     param, form field, dropdown, or any other user-editable input) — see
 *     TenantSettingsPage, which is the only caller.
 *   - `/tenants` (list), `/tenants` (create), `/tenants/:id/activate`,
 *     `/tenants/:id/suspend`, and `DELETE /tenants/:id` are intentionally
 *     NOT wrapped here at all — those are platform-registry/lifecycle
 *     operations with no legitimate self-service use, not "this tenant's
 *     own configuration" (see PHASE 2 — TENANT SETTINGS brief §7: Platform
 *     Operator is a separate boundary; do not expose platform-only tenant
 *     management controls in the tenant shell).
 * This restricts what a well-behaved instance of this UI can do; it is
 * NOT a security boundary and must not be described as one. The real fix
 * (scoping every TenantsRepository method to the caller's own tenant id
 * unless the caller is a Platform Operator) belongs in the backend and is
 * reported as a blocking finding in the Phase 2 Tenant Settings
 * verification report.
 */
export function getOwnTenant(tenantId: string): Promise<TenantRecord> {
  return apiRequest<TenantRecord>(`/tenants/${tenantId}`);
}

export function updateOwnTenant(tenantId: string, input: UpdateTenantInput): Promise<TenantRecord> {
  return apiRequest<TenantRecord>(`/tenants/${tenantId}`, { method: "PATCH", body: input });
}
