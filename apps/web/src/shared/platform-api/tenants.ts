import { platformApiRequest } from "./client";
import type { ListParams, PaginatedResult } from "../api/types";

// Mirrors the real Tenant.status values (database/prisma/schema/tenant.prisma).
export type TenantStatus = "PROVISIONING" | "ACTIVE" | "SUSPENDED";

export interface PlatformTenant {
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

// Mirrors src/modules/tenants/dto/create-tenant.dto.ts
export interface CreateTenantInput {
  tenantCode: string;
  tenantName: string;
  legalName?: string;
  email?: string;
  phone?: string;
}

// Mirrors src/modules/tenants/dto/update-tenant.dto.ts (the platform-side
// DTO, which — unlike the tenant self-service one — still accepts status;
// TenantsService.activate()/suspend() apply no current-status validation
// of their own, so the dedicated activate/suspend actions below are
// preferred over sending status through this generic update).
export type UpdateTenantInput = Partial<Omit<CreateTenantInput, "tenantCode">> & { status?: TenantStatus };

const BASE = "/platform/tenants";

export function listPlatformTenants(params: ListParams = {}): Promise<PaginatedResult<PlatformTenant>> {
  return platformApiRequest<PaginatedResult<PlatformTenant>>(BASE, { query: params });
}

export function getPlatformTenant(id: string): Promise<PlatformTenant> {
  return platformApiRequest<PlatformTenant>(`${BASE}/${id}`);
}

export function createPlatformTenant(input: CreateTenantInput): Promise<PlatformTenant> {
  return platformApiRequest<PlatformTenant>(BASE, { method: "POST", body: input });
}

export function updatePlatformTenant(id: string, input: UpdateTenantInput): Promise<PlatformTenant> {
  return platformApiRequest<PlatformTenant>(`${BASE}/${id}`, { method: "PATCH", body: input });
}

export function activatePlatformTenant(id: string): Promise<PlatformTenant> {
  return platformApiRequest<PlatformTenant>(`${BASE}/${id}/activate`, { method: "POST" });
}

export function suspendPlatformTenant(id: string): Promise<PlatformTenant> {
  return platformApiRequest<PlatformTenant>(`${BASE}/${id}/suspend`, { method: "POST" });
}

/** Soft delete — TenantsService.remove() calls findById() then softDelete() unconditionally; no dependency/membership guard exists, same as Organization's own delete. */
export function deletePlatformTenant(id: string): Promise<null> {
  return platformApiRequest<null>(`${BASE}/${id}`, { method: "DELETE" });
}

// Phase 2UI.2 backend, Phase 2UI.3 frontend — mirrors
// src/modules/tenants/dto/bootstrap-tenant.dto.ts exactly. Deliberately
// flat (not nested organization/administrator objects) for the same
// reason the backend DTO is flat — see that file's own doc comment: no
// DTO in this codebase's backend uses nested validation, so the frontend
// input shape mirrors it 1:1 rather than inventing its own nesting.
export interface BootstrapTenantInput {
  organizationName: string;
  organizationTypeId?: string;
  organizationCode?: string;
  administratorEmail: string;
  administratorFirstName: string;
  administratorLastName: string;
  productIds?: string[];
}

export interface BootstrapTenantResult {
  tenant: PlatformTenant;
  organization: { id: string; tenantId: string; organizationCode: string; organizationName: string; status: string };
  administrator: { id: string; email: string; isNewIdentity: boolean };
  membership: { id: string; status: "ACTIVE" | "INVITED" };
  roleAssigned: string;
  entitlements: { productId: string; status: string }[];
  invitationSent: boolean;
}

/**
 * Gated on PLATFORM_TENANT_MANAGE (the same permission create()/update()
 * already require — no new permission code exists for this). One real
 * transaction server-side: creates the Organization, finds-or-creates the
 * global Administrator identity, the Membership, the TENANT_ADMIN role
 * grant, and any requested Product Entitlements atomically. Only callable
 * once per tenant — a tenant that already has an Organization (or isn't
 * PROVISIONING) is rejected with 409, real and DB-enforced, not merely a
 * client-side guard. See docs/TENANT_BOOTSTRAP.md.
 */
export function bootstrapPlatformTenant(id: string, input: BootstrapTenantInput): Promise<BootstrapTenantResult> {
  return platformApiRequest<BootstrapTenantResult>(`${BASE}/${id}/bootstrap`, { method: "POST", body: input });
}
